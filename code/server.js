/**
 * 海大停车场一键缴费 - 后端代理服务
 * ============================================
 *
 * 功能：
 *   接收车牌号 → 调用海大停车场API查询 → 提取 parkId/uuid →
 *   构造缴费URL → 返回前端跳转
 *
 * 真实API：
 *   GET /pms/action/mobile/getInRecordByPlateNo
 *     ?plateNo={车牌}&sceneType=pms&regionIndexCode=&time={时间戳}
 *
 * 使用：
 *   node server.js                    启动服务
 *   http://localhost:3000             前端页面
 *   http://localhost:3000/api/search?plate=琼A054DB         API模式
 *   http://localhost:3000/api/search?plate=琼A054DB&redirect=1  直接跳转
 */

const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 配置 ====================
const CONFIG = {
    // 海大停车场服务地址
    BASE_URL: 'https://hkioc.hainanu.edu.cn',
    // 车牌查询API（用户发现的实际接口）
    SEARCH_API: '/pms/action/mobile/getInRecordByPlateNo',
    // 搜索页面（获取session cookie用）
    SEARCH_PAGE: '/pms/carParkMobile/carpayment/search',
    // 费用查询API
    BILL_API: '/pms/action/mobile/bill',
    // 缴费页面路径前缀
    PAY_PATH: '/pms/carParkMobile/carpayment/carpaying/',
    // 请求超时
    TIMEOUT: 15000,
};

const LOG_DIR = path.join(__dirname, '..', 'log');

// ==================== 日志 ====================
function log(level, ...args) {
    const ts = new Date().toISOString().slice(11, 19);
    const prefix = { info: 'ℹ️', ok: '✅', err: '❌', req: '🚗' }[level] || '·';
    console.log(`[${ts}] ${prefix}`, ...args);
}

// ==================== 核心：车牌查询 ====================

/**
 * 查询车牌对应的停车场记录
 * 返回完整记录数据（入场时间、parkId、uuid等）
 */
async function queryPlate(plate) {
    const client = createClient();
    const cookies = await getSessionCookie();

    // 调用搜索API
    log('info', '查询车牌:', plate);
    const timestamp = Date.now();
    const apiResp = await client.get(CONFIG.BASE_URL + CONFIG.SEARCH_API, {
        params: {
            plateNo: plate,
            sceneType: 'pms',
            regionIndexCode: '',
            time: timestamp,
        },
        headers: {
            'Referer': CONFIG.BASE_URL + CONFIG.SEARCH_PAGE,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/plain, */*',
            'Cookie': cookies,
        },
    });

    const data = apiResp.data;

    if (data.code !== '0') {
        log('err', 'API返回错误:', data.msg || '未知错误');
        return null;
    }

    const record = getFirstRecord(data);
    if (!record) {
        log('err', '未找到停车记录');
        return null;
    }

    // 构造完整返回数据
    const result = {
        plate: record.carNo || plate,
        parkId: record.parkId || '',
        // enIndexCode 即 uuid
        enIndexCode: record.uuid || '',
        // 入场时间戳（毫秒）
        entryTime: record.createTime || null,
        // 停车场名称
        parkName: record.parkName || '',
        // 车辆类型
        vehicleType: record.vehicleType || null,
        // 原始记录（保留其他字段备用）
        raw: record,
    };

    log('ok', `parkId=${result.parkId}`);
    log('ok', `enIndexCode=${result.enIndexCode}`);
    log('ok', `入场时间=${result.entryTime ? new Date(result.entryTime).toLocaleString('zh-CN') : '无'}`);

    return result;
}

/**
 * 创建axios实例（公共请求头）
 */
function createClient() {
    return axios.create({
        timeout: CONFIG.TIMEOUT,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        },
    });
}

/**
 * 从API响应中提取第一条停车记录
 * 响应结构：{ code: "0", data: [{ parkId, uuid, carNo, ... }] }
 */
function getFirstRecord(data) {
    if (!data || typeof data !== 'object') return null;
    const list = data.data || data.result || data.rows || data.records || data.list;
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
}

/**
 * 获取搜索页的session cookie（供后续API调用使用）
 */
async function getSessionCookie() {
    const client = createClient();
    const resp = await client.get(CONFIG.BASE_URL + CONFIG.SEARCH_PAGE, {
        headers: { 'Referer': CONFIG.BASE_URL + '/' },
    });
    return (resp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}

/**
 * 查询停车费用
 * API: /pms/action/mobile/bill
 *   ?enRecordIndexCode={uuid}&parkId={parkId}&exPlateNo={plate}&exVehilceType={type}&time={ts}
 */
async function queryBill(plate, parkId, enIndexCode, vehicleType) {
    const client = createClient();
    const cookies = await getSessionCookie();

    const timestamp = Date.now();
    log('info', '查询费用...');

    const resp = await client.get(CONFIG.BASE_URL + CONFIG.BILL_API, {
        params: {
            enRecordIndexCode: enIndexCode,
            parkId: parkId,
            exPlateNo: plate,
            exVehilceType: vehicleType || 1,
            time: timestamp,
        },
        headers: {
            'Referer': CONFIG.BASE_URL + CONFIG.SEARCH_PAGE,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/plain, */*',
            'Cookie': cookies,
        },
    });

    const data = resp.data;
    // 完整响应保存到文件方便排查
    fs.writeFileSync(
        path.join(LOG_DIR, 'bill_response.json'),
        JSON.stringify(data, null, 2)
    );
    log('info', '费用响应已保存到 log/bill_response.json');
    log('info', '费用概要:', JSON.stringify(data).slice(0, 2000));

    if (data && data.code === '0') {
        const bill = data.data || data;
        // 计算距下次加钱的时间（基于extraData.periodEnd - 计费周期结束时间）
        let nextChargeMin = null, nextChargeFee = null;
        if (bill.extraData && bill.extraData.periodEnd) {
            const periodEnd = parseInt(bill.extraData.periodEnd);
            const now = Date.now();
            const remainMs = periodEnd - now;
            if (remainMs > 0) {
                nextChargeMin = Math.floor(remainMs / 60000);
                nextChargeFee = bill.extraData.periodPrice || null;
            }
        }
        return {
            totalFee: bill.totalCost || bill.totalFee || bill.payAmount || bill.amount || null,
            paidFee: bill.paidCost || bill.paidFee || bill.paidAmount || null,
            unpaidFee: bill.realCost || bill.unpaidFee || null,
            durationMinutes: bill.parkTime || bill.durationMinutes || bill.parkingTime || null,
            entryTimeStr: bill.inTime || bill.enCrossTime || bill.entryTime || null,
            chargeRuleName: bill.chargeRuleName || '',
            remainingTime: bill.remainingTime || null,
            nextChargeMin,   // 距下次加钱的分钟数
            nextChargeFee,   // 下次加钱金额
            raw: bill,
        };
    }

    log('err', '费用查询失败:', data.msg || data.message);
    return null;
}

/**
 * 构造缴费URL
 */
function buildPayUrl(plate, parkId, enIndexCode) {
    return CONFIG.BASE_URL + CONFIG.PAY_PATH +
        encodeURIComponent(plate) +
        '?parkId=' + encodeURIComponent(parkId) +
        '&enIndexCode=' + encodeURIComponent(enIndexCode);
}

// ==================== Express路由 ====================

// 静态文件
app.use(express.static(path.join(__dirname)));

// 前端首页 - 停车看板
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 便捷面板（看板集合页）
app.get('/board', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// 看板API：查询车牌 → 返回完整停车详情（含费用）
app.get('/api/detail', async (req, res) => {
    const plate = (req.query.plate || '').trim();

    if (!plate) {
        return res.status(400).json({
            success: false,
            error: '请提供车牌号，例如：?plate=琼A054DB',
        });
    }

    log('req', '查询详情:', plate);

    try {
        const result = await queryPlate(plate);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: '未找到停车记录，可能车辆不在停车场内',
                plate,
            });
        }

        const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);

        // 查询费用
        let bill = null;
        try {
            bill = await queryBill(
                result.plate,
                result.parkId,
                result.enIndexCode,
                result.vehicleType
            );
        } catch (e) {
            log('err', '费用查询异常:', e.message);
        }

        // 返回完整数据
        return res.json({
            success: true,
            plate: result.plate,
            parkId: result.parkId,
            enIndexCode: result.enIndexCode,
            entryTime: result.entryTime,
            parkName: result.parkName,
            vehicleType: result.vehicleType,
            payUrl,
            serverTime: Date.now(),
            // 费用数据
            bill: bill ? {
                totalFee: bill.totalFee,
                paidFee: bill.paidFee,
                unpaidFee: bill.unpaidFee,
                durationMinutes: bill.durationMinutes,
                entryTimeStr: bill.entryTimeStr,
                chargeRuleName: bill.chargeRuleName,
                remainingTime: bill.remainingTime,
                nextChargeMin: bill.nextChargeMin,
                nextChargeFee: bill.nextChargeFee,
            } : null,
        });

    } catch (err) {
        log('err', '请求失败:', err.message);
        return res.status(502).json({
            success: false,
            error: '请求停车场服务失败',
            plate,
        });
    }
});

// 缴费API：查询车牌 → 返回缴费URL（兼容旧版，用于快捷缴费页）
app.get('/api/search', async (req, res) => {
    const plate = (req.query.plate || '').trim();
    const shouldRedirect = req.query.redirect === '1';

    if (!plate) {
        return res.status(400).json({
            success: false,
            error: '请提供车牌号，例如：?plate=琼A054DB',
        });
    }

    log('req', '查询车牌:', plate);

    try {
        const result = await queryPlate(plate);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: '未找到该车牌的停车记录，请确认车辆在停车场内',
                plate,
            });
        }

        const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);

        log('ok', '缴费URL已生成');

        // 直接跳转模式
        if (shouldRedirect) {
            return res.redirect(302, payUrl);
        }

        // JSON返回模式
        return res.json({
            success: true,
            plate: result.plate,
            parkId: result.parkId,
            enIndexCode: result.enIndexCode,
            payUrl,
        });

    } catch (err) {
        log('err', '请求失败:', err.message);
        return res.status(502).json({
            success: false,
            error: '请求停车场服务失败，请稍后重试',
            plate,
        });
    }
});

// ==================== 启动 ====================
app.listen(PORT, () => {
    const lines = [
        '',
        '═'.repeat(52),
        '  🅿️  海大停车场一键缴费 - 代理服务',
        '═'.repeat(52),
        `  看板首页: http://localhost:${PORT}`,
        `  查询API:  http://localhost:${PORT}/api/search?plate=琼A054DB`,
        `  详情API:  http://localhost:${PORT}/api/detail?plate=琼A054DB`,
        '═'.repeat(52),
        '',
    ];
    console.log(lines.join('\n'));

    // 启动日志
    try {
        fs.appendFileSync(
            path.join(LOG_DIR, '服务运行日志.txt'),
            `[${new Date().toISOString()}] 服务启动 - 端口:${PORT}\n`
        );
    } catch (e) { /* 日志目录可能不存在 */ }
});
