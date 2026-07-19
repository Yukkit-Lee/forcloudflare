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
const SERVER_MONITOR_STATE_FILE = process.env.SERVER_MONITOR_STATE_FILE ||
    path.resolve(__dirname, '..', '..', '..', '..', 'last-state.json');

// ==================== 日志 ====================
function log(level, ...args) {
    const ts = new Date().toISOString().slice(11, 19);
    const prefix = { info: 'ℹ️', ok: '✅', err: '❌', req: '🚗' }[level] || '·';
    console.log(`[${ts}] ${prefix}`, ...args);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║                    数据流向说明                                ║
// ╠══════════════════════════════════════════════════════════════╣
// ║  前端 fetch('/api/detail?plate=琼A054DB')                     ║
// ║    ↓                                                         ║
// ║  server.js /api/detail 路由                                   ║
// ║    ├─ queryPlate(plate)     → 海大API getInRecordByPlateNo   ║
// ║    │   返回: { plate, parkId, enIndexCode(uuid),             ║
// ║    │           entryTime(createTime), parkName, vehicleType } ║
// ║    │                                                         ║
// ║    └─ queryBill(plate, parkId, enIndexCode, vehicleType,     ║
// ║                  entryTime)                                   ║
// ║         → 海大API /pms/action/mobile/bill                    ║
// ║         返回: { totalFee(totalCost), paidFee(paidCost),       ║
// ║                 unpaidFee(realCost), entryTimeStr(inTime),    ║
// ║                 durationMinutes(parkTime),                    ║
// ║                 paid(已缴费?), freeMin(剩余免费分钟),         ║
// ║                 nextChargeMin/Fee(距下次加钱) }               ║
// ║    ↓                                                         ║
// ║  前端 renderParkData() 渲染看板                                ║
// ║    ├─ 未缴费: 入场时间 + 停车时长 + 应缴金额 + 48h进度条       ║
// ║    └─ 已缴费: 剩余免费时间 + 停车时长 + ¥0 + 绿色提示          ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * [第1步] 查询车牌 → 获取停车记录
 * 调用海大 API: GET /pms/action/mobile/getInRecordByPlateNo
 *   ?plateNo={车牌}&sceneType=pms&regionIndexCode=&time={时间戳}
 *
 * 响应示例: { code:"0", data:[{
 *   carNo:"琼A054DB",        // → plate
 *   parkId:"76f837a6-...",   // → 缴费URL参数
 *   uuid:"87f37fc7...",      // → enIndexCode（缴费URL参数）
 *   createTime:1781275586083,// → entryTime（入场Unix毫秒时间戳）
 *   parkName:"海南大学海甸校区",
 *   vehicleType:1            // 1=小型车
 * }]}
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
 * [第2步] 查询停车费用
 * 调用海大 API: GET /pms/action/mobile/bill
 *   ?enRecordIndexCode={uuid} &parkId={parkId}
 *   &exPlateNo={plate} &exVehilceType={type} &time={ts}
 *
 * 响应关键字段:
 *   totalCost     → 总费用（应缴金额）
 *   paidCost      → 已缴金额
 *   realCost      → 未缴金额（0=已缴完）
 *   parkTime      → 已停分钟数
 *   inTime        → 入场时间字符串 "2026/06/12 22:46:26"
 *   remainingTime → 缴费后剩余免费分钟数（仅缴费后有值）
 *   type          → "0"=未缴费 "1"=已缴费
 *   extraData     → { periodEnd(计费周期结束), periodPrice }
 *
 * 本函数额外计算:
 *   paid        → type==="1" 或 (realCost==0 && paidCost>0)
 *   freeMin     → 缴费后 remainingTime 转整数
 *   nextChargeMin/Fee → 根据计费规则 ¥3@07:00 / ¥2@22:00 计算
 */
async function queryBill(plate, parkId, enIndexCode, vehicleType, entryTime) {
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
        // 判断是否已缴费未驶出
        const paid = bill.type === '1' || (parseFloat(bill.realCost || 0) === 0 && parseFloat(bill.paidCost || 0) > 0);
        const freeMin = paid ? parseInt(bill.remainingTime || 0) : 0;

        // 根据实际计费规则计算：¥3@07:00 ¥2@22:00交替
        const parkMin = parseInt(bill.parkTime || 0);
        const curFee = bill.totalCost || '0';
        // 已缴费状态下，下次加钱从免费期结束时算起
        const calcEntry = paid && freeMin > 0 ? Date.now() + freeMin * 60000 : entryTime;
        const ni = calcNextCharge(calcEntry, paid ? 0 : parkMin, paid ? '0' : curFee);
        return {
            totalFee: bill.totalCost || bill.totalFee || null,
            paidFee: bill.paidCost || bill.paidFee || null,
            unpaidFee: bill.realCost || null,
            durationMinutes: bill.parkTime || null,
            entryTimeStr: bill.inTime || bill.enCrossTime || null,
            chargeRuleName: bill.chargeRuleName || '',
            paid,
            freeMin,
            nextChargeMin: ni.min,
            nextChargeFee: ni.fee,
            raw: bill,
        };
    }

    log('err', '费用查询失败:', data.msg || data.message);
    return null;
}

/**
 * 计费规则：
 *   白天进场(07-22): <30min免费→¥3→22:00+¥2→07:00+¥3→...
 *     关键：过24h周期边界后，下个22:00加¥5（新周期夜间费），不是¥2
 *   夜间进场(22-07): ¥5→07:00+¥3→22:00+¥2→07:00+¥3→...
 *     注意：同一24h周期内22:00加¥2，跨周期后22:00加¥5
 */
function calcNextCharge(entryTs, parkMin, currentFee) {
    if (!entryTs) return { min: null, fee: null };
    const now = Date.now();
    const h = new Date(entryTs).getHours();
    const isNight = h >= 22 || h < 7;
    const feeNum = parseFloat(currentFee) || 0;
    const elapsed = parkMin || 0;

    if (feeNum === 0) {
        if (isNight) return { min: 0, fee: 5 };
        if (elapsed < 30) return { min: 30 - elapsed, fee: 3 };
        return { min: 0, fee: 3 };
    }

    // 24h周期边界（从入场时刻算）
    const msPer24h = 24 * 3600 * 1000;
    const periodsDone = Math.floor((now - entryTs) / msPer24h);
    const nextPeriodStart = entryTs + (periodsDone + 1) * msPer24h;

    // 最近07:00 和 22:00
    const n7 = new Date(now); n7.setHours(7,0,0,0); if (n7<=now) n7.setDate(n7.getDate()+1);
    const n22 = new Date(now); n22.setHours(22,0,0,0); if (n22<=now) n22.setDate(n22.getDate()+1);

    // 22:00 的费用取决于是否跨24h周期边界
    //   同一周期内: ¥2（夜间补充）
    //   跨周期后:   ¥5（新周期夜间费）
    const fee22 = n22.getTime() >= nextPeriodStart ? 5 : 2;

    const cand = [{t:n7.getTime(),fee:3},{t:n22.getTime(),fee:fee22}].sort((a,b)=>a.t-b.t);
    const rem = Math.floor((cand[0].t - now) / 60000);
    return rem > 0 ? { min: rem, fee: cand[0].fee } : { min: null, fee: null };
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

// 服务器状态面板（本地版）：直接读取 andy 监控器写入的状态文件。
app.get('/api/server-status', (req, res) => {
    try {
        const state = JSON.parse(fs.readFileSync(SERVER_MONITOR_STATE_FILE, 'utf8'));
        const result = state.last_result || {};
        const checkedAt = state.last_checked_at || result.checked_at || null;
        const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
        const stale = !Number.isFinite(checkedMs) || Date.now() - checkedMs > 3 * 60 * 1000;
        res.set('Cache-Control', 'no-store');
        res.json({
            source: 'local',
            host: result.host || null,
            connectivity: stale ? 'STALE' : (state.last_connectivity || (result.status === 'OFFLINE' ? 'OFFLINE' : 'UNKNOWN')),
            last_confirmed_os: state.last_confirmed_os || 'UNKNOWN',
            status: result.status || state.last_status || 'UNKNOWN',
            checked_at: checkedAt,
            consecutive_offline_count: state.consecutive_offline_count || 0,
            last_state_change_at: state.last_state_change_at || null,
            reason: result.reason || '暂无检测结果',
            ports: result.ports || {},
            ping: Boolean(result.ping),
        });
    } catch (e) {
        res.status(503).json({
            source: 'local', error: '无法读取服务器监控状态文件', detail: e.code || e.message,
        });
    }
});

/**
 * [前端调用] GET /api/detail?plate=琼A054DB
 * 串联 queryPlate + queryBill，返回前端渲染所需全部数据
 *
 * 返回字段流向:
 *   entryTime → dashboard.html 渲染 "入场时间" 或 fmtTs 格式化
 *   parkName  → dashboard.html 卡片副标题
 *   bill.totalFee   → "应缴金额 ¥X.XX"
 *   bill.durationMinutes → "停车时长 X小时X分"
 *   bill.entryTimeStr → "入场时间" 优先使用 bill 返回的字符串
 *   bill.paid / bill.freeMin → 决定渲染"已缴费未驶出"或"停车中"
 *   bill.nextChargeMin/Fee → "XhXm后加¥X" 倒计时
 *   payUrl → "一键缴费"按钮跳转目标
 */
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

        // queryPlate 返回 null → 车辆未入场，前端 renderEmpty() 显示 🚗 + 提示
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
                result.vehicleType,
                result.entryTime
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
                paid: bill.paid,
                freeMin: bill.freeMin,
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
            path.join(LOG_DIR, 'server.log'),
            `[${new Date().toISOString()}] 服务启动 - 端口:${PORT}\n`
        );
    } catch (e) { /* 日志目录可能不存在 */ }
});
