class TaskQueue {
    constructor(concurrencyLimit = 5) {
        this.concurrencyLimit = concurrencyLimit;
        this.running = 0;
        this.queue = [];
        this.tasks = new Map();
        this.completedTasks = 0;
        this.failedTasks = 0;
    }

    /**
     * 将任务添加到队列
     * @param {Function} task - 要执行的任务函数
     * @param {Object} options - 任务选项
     * @param {number} options.priority - 任务优先级（数字越大优先级越高）
     * @param {number} options.retries - 失败重试次数
     * @param {string} options.taskId - 任务唯一标识
     * @returns {Promise} 任务执行的Promise
     */
    async addTask(task, options = {}) {
        const {
            priority = 0,
            retries = 3,
            taskId = Date.now() + Math.random().toString(36).substring(7)
        } = options;

        return new Promise((resolve, reject) => {
            const taskInfo = {
                task,
                priority,
                retries,
                remainingRetries: retries,
                resolve,
                reject,
                taskId
            };

            this.tasks.set(taskId, taskInfo);
            this.queue.push(taskInfo);
            this.queue.sort((a, b) => b.priority - a.priority);
            
            this.processQueue();
        });
    }

    /**
     * 处理队列中的任务
     * @private
     */
    async processQueue() {
        if (this.running >= this.concurrencyLimit || this.queue.length === 0) {
            return;
        }

        this.running++;
        const taskInfo = this.queue.shift();

        try {
            const result = await taskInfo.task();
            taskInfo.resolve(result);
            this.completedTasks++;
        } catch (error) {
            if (taskInfo.remainingRetries > 0) {
                taskInfo.remainingRetries--;
                this.queue.push(taskInfo);
                console.log(`任务 ${taskInfo.taskId} 执行失败，将重试。剩余重试次数: ${taskInfo.remainingRetries}`);
            } else {
                taskInfo.reject(error);
                this.failedTasks++;
                console.error(`任务 ${taskInfo.taskId} 执行失败，已达到最大重试次数:`, error);
            }
        } finally {
            this.running--;
            this.tasks.delete(taskInfo.taskId);
            this.processQueue();
        }
    }

    /**
     * 获取队列状态
     * @returns {Object} 队列状态信息
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            runningTasks: this.running,
            completedTasks: this.completedTasks,
            failedTasks: this.failedTasks,
            totalTasks: this.queue.length + this.running + this.completedTasks + this.failedTasks
        };
    }

    /**
     * 清空队列
     */
    clear() {
        this.queue = [];
    }
}

/**
 * 创建并发任务处理队列
 * @param {Function[]} tasks - 任务数组
 * @param {number} limit - 并发限制
 * @param {Function} onProgress - 进度回调函数
 * @returns {Promise<Array>} 所有任务的结果
 */
async function concurrentQueue(tasks, limit = 5, onProgress) {
    const taskQueue = new TaskQueue(limit);
    const results = [];
    const total = tasks.length;

    const promises = tasks.map((task, index) => {
        return taskQueue.addTask(task, {
            taskId: `task-${index}`,
            priority: 0,
            retries: 3
        }).then(result => {
            results[index] = result;
            if (onProgress) {
                const progress = ((taskQueue.completedTasks / total) * 100).toFixed(1);
                onProgress(progress, taskQueue.getStatus());
            }
            return result;
        });
    });

    await Promise.all(promises);
    return results;
}

module.exports = {
    TaskQueue,
    concurrentQueue
};
