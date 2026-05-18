const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');

const config = {
    host: process.env.SERVER_HOST,
    port: parseInt(process.env.SERVER_PORT) || 25565,
    username: process.env.BOT_USERNAME,
    auth: 'offline',
    version: process.env.MC_VERSION || '1.21.4',
    hideErrors: false,
    checkTimeoutInterval: 30000,
    keepAlive: true
};

let bot = null;
let antiAFKInterval = null;
let reconnectCount = 0;
let connectionTimeout = null;
const MAX_RECONNECTS = 20;

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

function createBot() {
    if (reconnectCount >= MAX_RECONNECTS) {
        log('Too many reconnect attempts. Stopping.');
        process.exit(1);
    }

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

        // Timeout if not spawned in 45 seconds
        connectionTimeout = setTimeout(() => {
            log('⏱️ Connection timed out (no spawn after 45s). Reconnecting...');
            if (bot) {
                try { bot.end(); } catch (e) {}
            }
            reconnectCount++;
            setTimeout(createBot, 15000);
        }, 45000);

    } catch (err) {
        log(`❌ Failed to create bot: ${err.message}`);
        reconnectCount++;
        setTimeout(createBot, 30000);
    }
}

function setupEvents() {

    bot.on('login', () => {
        log(`🔑 Logged in! Waiting for spawn...`);
    });

    bot.on('spawn', () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        log(`✅ Bot spawned as "${bot.username}"`);
        log(`📍 Position: ${JSON.stringify(bot.entity.position)}`);
        reconnectCount = 0;
        startAntiAFK();
    });

    bot.on('message', (msg) => {
        log(`💬 Chat: ${msg.toString()}`);
    });

    bot.on('kicked', (reason) => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        log(`⚠️ Kicked! Raw reason: ${JSON.stringify(reason)}`);
        stopAntiAFK();
        reconnectCount++;
        setTimeout(createBot, 45000);
    });

    bot.on('error', (err) => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        log(`❌ Error: ${err.message}`);
        log(`Error code: ${err.code || 'N/A'}`);
        stopAntiAFK();
        reconnectCount++;
        setTimeout(createBot, 30000);
    });

    bot.on('end', (reason) => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        log(`🔌 Disconnected: ${reason}`);
        stopAntiAFK();
        reconnectCount++;
        setTimeout(createBot, 25000);
    });

    bot.on('death', () => {
        log('💀 Bot died. Respawning...');
        setTimeout(() => bot.respawn(), 2000);
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
        if (!bot || !bot.entity) return;

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
                    setTimeout(() => bot && bot.setControlState('jump', false), 200);
                    log('⬆️ Jumped');
                    break;
                case 2:
                    bot.setControlState('forward', true);
                    setTimeout(() => bot && bot.setControlState('forward', false), 800);
                    log('🚶 Walked forward');
                    break;
                case 3:
                    bot.look(bot.entity.yaw + (Math.random() - 0.5), Math.random() * 0.4 - 0.2, true);
                    log('👀 Adjusted view');
                    break;
                case 4:
                    bot.setControlState('sneak', true);
                    setTimeout(() => bot && bot.setControlState('sneak', false), 600);
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
}

createBot();

process.on('uncaughtException', (err) => log(`Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`Unhandled: ${reason}`));
