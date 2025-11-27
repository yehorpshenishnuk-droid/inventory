// Простая и сверхбыстрая система блокировок в памяти сервера

const locks = new Map();

// Таймаут блокировки — 30 минут
const LOCK_TIMEOUT = 30 * 60 * 1000;

function cleanup() {
    const now = Date.now();

    for (const [loc, data] of locks.entries()) {
        if (now - data.time > LOCK_TIMEOUT) {
            locks.delete(loc);
        }
    }
}

function setLock(location, userName) {
    cleanup();
    locks.set(String(location), {
        userName,
        time: Date.now()
    });
}

function getLock(location) {
    cleanup();
    return locks.get(String(location)) || null;
}

function removeLock(location) {
    locks.delete(String(location));
}

function getAllLocks() {
    cleanup();
    const result = {};

    for (const [loc, data] of locks.entries()) {
        result[loc] = data;
    }

    return result;
}

export default {
    setLock,
    getLock,
    removeLock,
    getAllLocks
};
