/**
 * 并发队列处理函数
 * @param {Function[]} tasks - 任务数组
 * @param {number} limit - 并发限制
 * @returns {Promise<void>}
 */
async function concurrentQueue(tasks, limit) {
    const executing = [];
    let i = 0;

    const executeNext = async () => {
        if (i >= tasks.length) {
            return;
        }

        const task = tasks[i++];
        const p = task();
        executing.push(p);

        p.finally(() => {
            executing.splice(executing.indexOf(p), 1);
        });

        if (executing.length >= limit) {
            await Promise.race(executing);
        }
        await executeNext();
    };

    for (let j = 0; j < limit && j < tasks.length; j++) {
        executeNext();
    }

    await Promise.all(executing);
}

module.exports = {
    concurrentQueue
};
