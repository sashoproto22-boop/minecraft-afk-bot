const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');

const config = {
    host: process.env.SERVER_HOST,
    port: parseInt(process.env.SERVER_PORT) || 25565,
    username: process.env.BOT_USERNAME,
    auth: 'offline',
    version: process.env.MC_VERSION || '1.20.1',
    hideErrors: false,
    checkTimeoutInterval: 30000,
    keepAlive: true
};

let bot = null;
let actionTimeout = null;
let healthCheckInterval = null;
let connectionTimeout = null;
let reconnectCount = 0;
let isReconnecting = false;
let isShuttingDown = false;
let lastPacketTime = Date.now();
let inActivityBurst = false;
const MAX_RECONNECTS = 50;

// ============================================
// 🎭 HUMAN-LIKE CHAT MESSAGES
// ============================================
const CHAT_MESSAGES = {
    // Casual/reactions
    casual: [
        "lol", "lmao", "lmaoo", "bruh", "bro", "nahh", "fr", "frfr",
        "ong", "no way", "wait what", "huh", "wtf", "wth", "what",
        "ok", "okk", "kk", "k", "alr", "alright", "bet", "say less",
        "nice", "cool", "sick", "based", "W", "L", "ratio", "fax",
        "tru", "true", "exactly", "deadass", "no cap", "cap", "facts"
    ],
    // AFK related
    afk: [
        "afk", "brb", "back in 5", "bbl", "1 sec", "one sec",
        "hold on", "wait", "moment", "g2g brb", "lemme check smth",
        "phone call", "mom calling", "doorbell", "food time"
    ],
    // Tired/sleepy
    tired: [
        "z", "zz", "zzz", "zzzz", "tired", "sleepy", "sleepyy",
        "imma sleep", "going to bed", "gn", "gn yall", "tired af"
    ],
    // Random typos / keysmash
    typos: [
        "ye", "yea", "yeah", "yh", "yep", "yup", "yepp",
        "asdf", "sdfg", "fsdf", "wsg", "tf", "smh", "lowkey",
        "highkey", "ngl", "tbh", "imo", "idk", "idek", "dunno"
    ],
    // Questions
    questions: [
        "anyone on?", "hello?", "yo", "hi", "sup", "hey",
        "anybody here", "u there", "you there?", "wsg",
        "what u doing", "wyd", "hbu", "u good"
    ],
    // Reactions to game
    gameReactions: [
        "lag", "lagging", "rip", "F", "fml", "noo",
        "wifi died", "ping spike", "stuck", "what just happened",
        "this lag", "server lag", "where am i"
    ]
};

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// 🧹 BOT LIFECYCLE
// ============================================
function destroyBot() {
    if (bot) {
        try {
            bot.removeAllListeners();
            if (bot._client) {
                bot._client.removeAllListeners();
                try { bot._client.end(); } catch(e) {}
                try { bot._client.destroy(); } catch(e) {}
            }
            try { bot.quit(); } catch(e) {}
            try { bot.end(); } catch(e) {}
        } catch (e) {}
        bot = null;
    }
    stopAntiAFK();
    if (connectionTimeout) clearTimeout(connectionTimeout);
    if (healthCheckInterval) clearInterval(healthCheckInterval);
}

function scheduleReconnect(reason, delay = 30000) {
    if (isShuttingDown || isReconnecting) return;

    isReconnecting = true;
    log(`🔄 Reconnecting in ${delay/1000}s. Reason: ${reason}`);

    destroyBot();
    reconnectCount++;

    if (reconnectCount >= MAX_RECONNECTS) {
        log('❌ Too many reconnects. Stopping.');
        process.exit(1);
    }

    setTimeout(() => {
        isReconnecting = false;
        createBot();
    }, delay);
}

function createBot() {
    if (isShuttingDown) return;

    log(`==================================`);
    log(`🤖 Attempt ${reconnectCount + 1} - Connecting...`);
    log(`==================================`);

    try {
        bot = mineflayer.createBot(config);
        bot.loadPlugin(pathfinder);
        setupEvents();

        connectionTimeout = setTimeout(() => {
            log('⏱️ Connection timeout (60s)');
            scheduleReconnect('Connection timeout', 30000);
        }, 60000);

    } catch (err) {
        log(`❌ Bot creation failed: ${err.message}`);
        scheduleReconnect('Bot creation failed', 30000);
    }
}

function setupEvents() {
    bot.on('login', () => log(`🔑 Logged in!`));

    bot.on('spawn', () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        if (!bot || !bot.entity) return;
        log(`✅ Spawned as "${bot.username}" at ${JSON.stringify(bot.entity.position)}`);
        reconnectCount = 0;
        startAntiAFK();
        startHealthCheck();

        // Say hi randomly after joining (30% chance)
        if (Math.random() < 0.3) {
            setTimeout(() => {
                if (bot) {
                    const greetings = ["yo", "hi", "back", "im back", "sup", "hey"];
                    try { bot.chat(greetings[Math.floor(Math.random() * greetings.length)]); } catch(e){}
                }
            }, 3000 + Math.random() * 5000);
        }
    });

    bot.on('message', (msg) => {
        try { log(`💬 ${msg.toString()}`); } catch (e) {}
    });

    bot.on('kicked', (reason) => {
        let kickText = String(reason);
        try {
            const parsed = JSON.parse(reason);
            kickText = parsed.translate || parsed.text || JSON.stringify(parsed);
        } catch (e) {}

        log(`⚠️ Kicked: ${kickText}`);

        let delay = 30000;
        if (kickText.includes('throttled')) delay = 60000;
        else if (kickText.includes('duplicate_login')) delay = 45000;
        else if (kickText.includes('banned')) {
            log('🚫 BANNED. Stopping.');
            process.exit(1);
        }

        scheduleReconnect(`Kicked: ${kickText}`, delay);
    });

    bot.on('error', (err) => {
        log(`❌ Error: ${err.message}`);
        scheduleReconnect(`Error: ${err.message}`, 30000);
    });

    bot.on('end', (reason) => {
        log(`🔌 Disconnected: ${reason}`);
        scheduleReconnect(`Disconnected: ${reason}`, 25000);
    });

    bot.on('death', () => {
        log('💀 Died. Respawning...');
        setTimeout(() => { try { if (bot) bot.respawn(); } catch(e) {} }, 2000);
    });
}

// ============================================
// 🩺 HEALTH CHECK - detects dead connections
// ============================================
function startHealthCheck() {
    if (healthCheckInterval) clearInterval(healthCheckInterval);
    lastPacketTime = Date.now();

    if (bot && bot._client) {
        bot._client.on('packet', () => {
            lastPacketTime = Date.now();
        });
    }

    healthCheckInterval = setInterval(() => {
        if (!bot || isReconnecting) return;
        const timeSince = Date.now() - lastPacketTime;
        if (timeSince > 90000) {
            log(`💔 No packets for ${Math.floor(timeSince/1000)}s - dead connection!`);
            scheduleReconnect('Health check failed', 15000);
        }
    }, 30000);
}

// ============================================
// 🎭 HUMAN-LIKE ACTIONS
// ============================================

function getRandomChat() {
    // Pick a category, then pick a message
    const categories = Object.keys(CHAT_MESSAGES);
    const category = categories[Math.floor(Math.random() * categories.length)];
    const messages = CHAT_MESSAGES[category];
    return messages[Math.floor(Math.random() * messages.length)];
}

function getRandomDelay() {
    // Humans don't act every X seconds. They have bursts and idle periods.

    if (inActivityBurst) {
        // Active period: action every 1-4 seconds
        return 1000 + Math.random() * 3000;
    } else {
        // Idle period: action every 8-25 seconds
        return 8000 + Math.random() * 17000;
    }
}

function maybeToggleBurst() {
    // 5% chance per action to switch between active/idle
    if (Math.random() < 0.05) {
        inActivityBurst = !inActivityBurst;
        log(inActivityBurst ? '⚡ Activity burst started' : '😴 Going idle');
    }
}

function getWeightedAction() {
    // Realistic weighting based on what a human does
    const actions = [
        // Most common: looking around
        'look', 'look', 'look', 'look', 'look',
        // Common: small movements
        'walk', 'walk', 'walk',
        'jump', 'jump',
        'rotate', 'rotate',
        // Medium: gameplay
        'sprint', 'sprint',
        'sneak',
        'leftClick', 'leftClick',
        'rightClick',
        'hotbar', 'hotbar',
        // Less common
        'wander',
        'inventory',
        // Rare: chat
        'chat'
    ];
    return actions[Math.floor(Math.random() * actions.length)];
}

function startAntiAFK() {
    stopAntiAFK();
    log('🤖 Anti-AFK started (ULTRA HUMAN MODE)');

    try {
        const mcData = mcDataLoader(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
    } catch (err) {
        log(`Pathfinder error: ${err.message}`);
    }

    scheduleNextAction();
}

function scheduleNextAction() {
    if (!bot || isReconnecting || isShuttingDown) return;
    const delay = getRandomDelay();
    actionTimeout = setTimeout(() => {
        performAction();
        maybeToggleBurst();
        scheduleNextAction();
    }, delay);
}

function performAction() {
    if (!bot || !bot.entity || isReconnecting || isShuttingDown) return;

    const action = getWeightedAction();

    try {
        switch(action) {
            // 👀 LOOK AROUND
            case 'look':
                bot.look(
                    Math.random() * Math.PI * 2,
                    (Math.random() - 0.5) * 1.4,
                    true
                );
                log(`👀 Look`);
                break;

            // 🔄 SLOW ROTATION
            case 'rotate':
                const targetYaw = bot.entity.yaw + (Math.random() - 0.5) * Math.PI * 0.8;
                bot.look(targetYaw, bot.entity.pitch, true);
                log(`🔄 Rotate`);
                break;

            // ⬆️ JUMP
            case 'jump':
                bot.setControlState('jump', true);
                setTimeout(() => { try { if (bot) bot.setControlState('jump', false); } catch(e){} }, 100 + Math.random() * 400);
                log(`⬆️ Jump`);
                break;

            // 🚶 WALK (random direction)
            case 'walk':
                const dirs = ['forward', 'back', 'left', 'right'];
                const dir = dirs[Math.floor(Math.random() * dirs.length)];
                bot.setControlState(dir, true);
                setTimeout(() => { try { if (bot) bot.setControlState(dir, false); } catch(e){} }, 300 + Math.random() * 1500);
                log(`🚶 Walk ${dir}`);
                break;

            // 🏃 SPRINT
            case 'sprint':
                bot.setControlState('sprint', true);
                bot.setControlState('forward', true);
                setTimeout(() => {
                    try {
                        if (bot) {
                            bot.setControlState('sprint', false);
                            bot.setControlState('forward', false);
                        }
                    } catch(e){}
                }, 500 + Math.random() * 2000);
                log(`🏃 Sprint`);
                break;

            // 🦆 SNEAK
            case 'sneak':
                bot.setControlState('sneak', true);
                setTimeout(() => { try { if (bot) bot.setControlState('sneak', false); } catch(e){} }, 400 + Math.random() * 2000);
                log(`🦆 Sneak`);
                break;

            // 👊 LEFT CLICK (attack/break)
            case 'leftClick':
                try {
                    // Swing arm
                    bot.swingArm('right');
                    log(`👊 Left click`);
                } catch(e){}
                break;

            // ✋ RIGHT CLICK (use item)
            case 'rightClick':
                try {
                    // Look slightly down/around first
                    bot.look(
                        bot.entity.yaw,
                        (Math.random() - 0.5) * 0.8,
                        true
                    );
                    // Activate held item
                    bot.activateItem();
                    setTimeout(() => { try { if (bot) bot.deactivateItem(); } catch(e){} }, 100 + Math.random() * 500);
                    log(`✋ Right click`);
                } catch(e){}
                break;

            // 🎒 OPEN INVENTORY
            case 'inventory':
                try {
                    // Mineflayer doesn't have a real "open inventory" but we can simulate by checking items
                    const items = bot.inventory.items();
                    log(`🎒 Checked inventory (${items.length} items)`);
                    // Close any open window after random time
                    if (bot.currentWindow) {
                        setTimeout(() => {
                            try { if (bot && bot.currentWindow) bot.closeWindow(bot.currentWindow); } catch(e){}
                        }, 1000 + Math.random() * 3000);
                    }
                } catch(e){}
                break;

            // 🔢 CHANGE HOTBAR SLOT
            case 'hotbar':
                try {
                    const newSlot = Math.floor(Math.random() * 9);
                    bot.setQuickBarSlot(newSlot);
                    log(`🔢 Hotbar slot ${newSlot}`);
                } catch(e){}
                break;

            // 🗺️ WANDER (pathfinder)
            case 'wander':
                if (bot.pathfinder && !bot.pathfinder.isMoving()) {
                    const pos = bot.entity.position;
                    const goal = new goals.GoalNear(
                        pos.x + (Math.random() * 12 - 6),
                        pos.y,
                        pos.z + (Math.random() * 12 - 6),
                        1
                    );
                    bot.pathfinder.goto(goal).catch(() => {});
                    log(`🗺️ Wander`);
                }
                break;

            // 💬 CHAT
            case 'chat':
                // Only 30% of "chat" rolls actually send a message (otherwise too spammy)
                if (Math.random() < 0.3) {
                    const msg = getRandomChat();
                    try {
                        bot.chat(msg);
                        log(`💬 Said: "${msg}"`);
                    } catch(e){}
                }
                break;
        }
    } catch (err) {
        log(`Action error: ${err.message}`);
    }
}

function stopAntiAFK() {
    if (actionTimeout) {
        clearTimeout(actionTimeout);
        actionTimeout = null;
    }
    if (bot) {
        try {
            ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].forEach(c => {
                try { bot.setControlState(c, false); } catch(e) {}
            });
        } catch (e) {}
    }
}

// ============================================
// 🚀 START
// ============================================
createBot();

process.on('uncaughtException', (err) => log(`💥 Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`💥 Unhandled: ${reason}`));
process.on('SIGTERM', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
process.on('SIGINT', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
