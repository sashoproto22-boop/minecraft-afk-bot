const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mcDataLoader = require('minecraft-data');

const config = {
    host: process.env.SERVER_HOST,
    port: parseInt(process.env.SERVER_PORT) || 25565,
    username: process.env.BOT_USERNAME,
    auth: 'offline',
    version: process.env.MC_VERSION || '1.21.1',  // ← Uses your server's version
    hideErrors: false
};

let bot = null;
let antiAFKInterval = null;
let reconnectCount = 0;
const MAX_RECONNECTS = 10;

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

function createBot() {
    if (reconnectCount >= MAX_RECONNECTS) {
        log('Too many reconnect attempts. Stopping.');
        process.exit(1);
    }

    log(`Connecting to ${config.host} (version ${config.version})... (Attempt ${reconnectCount + 1})`);

    try {
        bot = mineflayer.createBot(config);
        bot.loadPlugin(pathfinder);
        setupEvents();
    } catch (err) {
        log(`Failed to create bot: ${err.message}`);
        reconnectCount++;
        setTimeout(createBot, 30000);
    }
}

function setupEvents() {
    bot.on('spawn', () => {
        log(`✅ Bot spawned as "${bot.username}"`);
        log(`📍 Position: ${JSON.stringify(bot.entity.position)}`);
        reconnectCount = 0;
        startAntiAFK();
    });

    bot.on('message', (msg) => {
        log(`💬 Chat: ${msg.toString()}`);
    });

    bot.on('kicked', (reason) => {
        let kickReason = reason;
        try {
            const parsed = JSON.parse(reason);
            kickReason = parsed.text || parsed.translate || reason;
        } catch (e) {}

        log(`⚠️ Kicked: ${kickReason}`);
        stopAntiAFK();
        reconnectCount++;
        setTimeout(createBot, 45000);
    });

    bot.on('error', (err) => {
        log(`❌ Error: ${err.message}`);
        stopAntiAFK();
        reconnectCount++;
        setTimeout(createBot, 30000);
    });

    bot.on('end', (reason) => {
        log(`🔌 Disconnected: ${reason}`);
        stopAntiAFK();
        reconnectCount++;
        setTimeout(createBot, 25000);
    });

    bot.on('health', () => {
        if (bot.health < 5) {
            log(`❗ Low health: ${bot.health}. Bot might die!`);
        }
    });

    bot.on('death', () => {
        log('💀 Bot died. Respawning...');
        setTimeout(() => {
            bot.respawn();
        }, 2000);
    });
}

function startAntiAFK() {
    stopAntiAFK();

    log('🤖 Anti-AFK started');

    let mcData;
    try {
        mcData = mcDataLoader(bot.version);
        const movements = new Movements(bot, mcData);
        movements.scafoldingBlocks = [];
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
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = Math.random() * 0.6 - 0.3;
                    bot.look(yaw, pitch, true);
                    log('👀 Looking around');
                    break;

                case 1:
                    bot.setControlState('jump', true);
                    setTimeout(() => {
                        if (bot) bot.setControlState('jump', false);
                    }, 200);
                    log('⬆️ Jumped');
                    break;

                case 2:
                    bot.setControlState('forward', true);
                    setTimeout(() => {
                        if (bot) bot.setControlState('forward', false);
                    }, 800);
                    log('🚶 Walked forward');
                    break;

                case 3:
                    bot.look(
                        bot.entity.yaw + (Math.random() * 1.0 - 0.5),
                        Math.random() * 0.4 - 0.2,
                        true
                    );
                    log('👀 Adjusted view');
                    break;

                case 4:
                    bot.setControlState('sneak', true);
                    setTimeout(() => {
                        if (bot) bot.setControlState('sneak', false);
                    }, 600);
                    log('🦆 Sneaked');
                    break;

                case 5:
                    if (bot.pathfinder && !bot.pathfinder.isMoving()) {
                        const pos = bot.entity.position;
                        const dx = Math.random() * 6 - 3;
                        const dz = Math.random() * 6 - 3;
                        const goal = new goals.GoalNear(
                            pos.x + dx,
                            pos.y,
                            pos.z + dz,
                            1
                        );
                        bot.pathfinder.goto(goal).catch(() => {});
                        log('🗺️ Wandering');
                    }
                    break;
            }
        } catch (err) {
            log(`Anti-AFK action error: ${err.message}`);
        }

    }, 8000);
}

function stopAntiAFK() {
    if (antiAFKInterval) {
        clearInterval(antiAFKInterval);
        antiAFKInterval = null;
        log('Anti-AFK stopped');
    }
}

createBot();

process.on('uncaughtException', (err) => {
    log(`Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    log(`Unhandled rejection: ${reason}`);
});
