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
let antiAFKInterval = null;
let connectionTimeout = null;
let reconnectCount = 0;
let isReconnecting = false;   // 🔒 LOCK to prevent multiple reconnects
let isShuttingDown = false;   // 🔒 LOCK to prevent reconnects during cleanup
const MAX_RECONNECTS = 50;    // More forgiving
const RECONNECT_DELAY = 30000; // 30 seconds between reconnects

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// 🧹 Properly destroy old bot before creating new one
function destroyBot() {
    if (bot) {
        try {
            // Remove ALL event listeners so old bot can't trigger reconnects
            bot.removeAllListeners();
            // Force close connection
            if (bot._client) {
                bot._client.removeAllListeners();
                try { bot._client.end(); } catch(e) {}
                try { bot._client.destroy(); } catch(e) {}
            }
            try { bot.quit(); } catch(e) {}
            try { bot.end(); } catch(e) {}
        } catch (e) {
            log(`Error destroying old bot: ${e.message}`);
        }
        bot = null;
    }
    stopAntiAFK();
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
    }
}

// 🔄 Safe reconnect - uses lock to prevent spam
function scheduleReconnect(reason, delay = RECONNECT_DELAY) {
    if (isShuttingDown) return;
    if (isReconnecting) {
        log(`⏭️  Already reconnecting, ignoring: ${reason}`);
        return;
    }

    isReconnecting = true;
    log(`🔄 Will reconnect in ${delay/1000}s. Reason: ${reason}`);

    destroyBot();
    reconnectCount++;

    if (reconnectCount >= MAX_RECONNECTS) {
        log('❌ Too many reconnect attempts. Stopping.');
        isShuttingDown = true;
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
    log(`Host: ${config.host}`);
    log(`Port: ${config.port}`);
    log(`Username: ${config.username}`);
    log(`Version: ${config.version}`);
    log(`Attempt: ${reconnectCount + 1}`);
    log(`==================================`);

    try {
        bot = mineflayer.createBot(config);
        bot.loadPlugin(pathfinder);
        setupEvents();

        // ⏱️ Timeout if not spawned in 60 seconds
        connectionTimeout = setTimeout(() => {
            log('⏱️ Connection timed out (no spawn after 60s)');
            scheduleReconnect('Connection timeout', 30000);
        }, 60000);

    } catch (err) {
        log(`❌ Failed to create bot: ${err.message}`);
        scheduleReconnect('Bot creation failed', 30000);
    }
}

function setupEvents() {

    bot.on('login', () => {
        log(`🔑 Logged in! Waiting for spawn...`);
    });

    bot.on('spawn', () => {
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
        }
        if (!bot || !bot.entity) {
            log('⚠️  Spawn event but bot.entity is missing!');
            return;
        }
        log(`✅ Bot spawned as "${bot.username}"`);
        log(`📍 Position: ${JSON.stringify(bot.entity.position)}`);
        reconnectCount = 0; // Reset on successful spawn
        startAntiAFK();
    });

    bot.on('message', (msg) => {
        try {
            log(`💬 Chat: ${msg.toString()}`);
        } catch (e) {}
    });

    bot.on('kicked', (reason) => {
        let kickText = String(reason);
        try {
            const parsed = JSON.parse(reason);
            kickText = parsed.translate || parsed.text || JSON.stringify(parsed);
        } catch (e) {}

        log(`⚠️ Kicked: ${kickText}`);

        // 🎯 Smart delay based on kick reason
        let delay = RECONNECT_DELAY;
        if (kickText.includes('throttled')) {
            delay = 60000; // Wait 1 minute if throttled
            log('⏳ Throttled - waiting 60s before reconnecting');
        } else if (kickText.includes('duplicate_login')) {
            delay = 45000; // Wait 45s if duplicate login
            log('👥 Duplicate login - waiting 45s');
        } else if (kickText.includes('banned')) {
            log('🚫 BANNED. Stopping bot.');
            isShuttingDown = true;
            process.exit(1);
        }

        scheduleReconnect(`Kicked: ${kickText}`, delay);
    });

    bot.on('error', (err) => {
        log(`❌ Error: ${err.message} (${err.code || 'no code'})`);
        scheduleReconnect(`Error: ${err.message}`, 30000);
    });

    bot.on('end', (reason) => {
        log(`🔌 Disconnected: ${reason}`);
        scheduleReconnect(`Disconnected: ${reason}`, 25000);
    });

    bot.on('death', () => {
        log('💀 Bot died. Respawning...');
        setTimeout(() => {
            try { if (bot) bot.respawn(); } catch(e) {}
        }, 2000);
    });
}

function startAntiAFK() {
    stopAntiAFK();
    log('🤖 Anti-AFK started');

    try {
        const mcData = mcDataLoader(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
    } catch (err) {
        log(`Pathfinder setup error: ${err.message}`);
    }

    let actionCount = 0;

    antiAFKInterval = setInterval(() => {
        if (!bot || !bot.entity || isReconnecting || isShuttingDown) return;

        actionCount++;
        const action = actionCount % 6;

        try {
            switch(action) {
                case 0:
                    bot.look(Math.random() * Math.PI * 2, Math.random() * 0.6 - 0.3, true);
                    log('👀 Looking around');
                    break;
                case 1:
                    bot.setControlState('jump', true);
                    setTimeout(() => { try { if (bot) bot.setControlState('jump', false); } catch(e){} }, 200);
                    log('⬆️ Jumped');
                    break;
                case 2:
                    bot.setControlState('forward', true);
                    setTimeout(() => { try { if (bot) bot.setControlState('forward', false); } catch(e){} }, 800);
                    log('🚶 Walked forward');
                    break;
                case 3:
                    bot.look(bot.entity.yaw + (Math.random() - 0.5), Math.random() * 0.4 - 0.2, true);
                    log('👀 Adjusted view');
                    break;
                case 4:
                    bot.setControlState('sneak', true);
                    setTimeout(() => { try { if (bot) bot.setControlState('sneak', false); } catch(e){} }, 600);
                    log('🦆 Sneaked');
                    break;
                case 5:
                    if (bot.pathfinder && !bot.pathfinder.isMoving()) {
                        const pos = bot.entity.position;
                        const goal = new goals.GoalNear(
                            pos.x + (Math.random() * 6 - 3),
                            pos.y,
                            pos.z + (Math.random() * 6 - 3),
                            1
                        );
                        bot.pathfinder.goto(goal).catch(() => {});
                        log('🗺️ Wandering');
                    }
                    break;
            }
        } catch (err) {
            log(`Anti-AFK error: ${err.message}`);
        }
    }, 8000);
}

function stopAntiAFK() {
    if (antiAFKInterval) {
        clearInterval(antiAFKInterval);
        antiAFKInterval = null;
    }
    // Also reset all controls
    if (bot) {
        try {
            ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].forEach(c => {
                try { bot.setControlState(c, false); } catch(e) {}
            });
        } catch (e) {}
    }
}

// 🚀 START
createBot();

// Catch crashes without dying
process.on('uncaughtException', (err) => {
    log(`💥 Uncaught: ${err.message}`);
    // Don't reconnect here - let normal handlers do it
});

process.on('unhandledRejection', (reason) => {
    log(`💥 Unhandled: ${reason}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    log('📴 SIGTERM received, shutting down...');
    isShuttingDown = true;
    destroyBot();
    process.exit(0);
});

process.on('SIGINT', () => {
    log('📴 SIGINT received, shutting down...');
    isShuttingDown = true;
    destroyBot();
    process.exit(0);
});
