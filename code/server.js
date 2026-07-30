/**
 * 海大停车场一键缴�?- 后端代理服务
 * ============================================
 *
 * 功能�?
 *   接收车牌�?�?调用海大停车场API查询 �?提取 parkId/uuid �?
 *   构造缴费URL �?返回前端跳转
 *
 * 真实API�?
 *   GET /pms/action/mobile/getInRecordByPlateNo
 *     ?plateNo={车牌}&sceneType=pms&regionIndexCode=&time={时间戳}
 *
 * 使用�?
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
    // 车牌查询API（用户发现的实际接口�?
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

// ==================== 健身�?API 配置 ====================
const GYM_CONFIG = {
    BASE_URL: 'https://api.sbooy.com',
    CURRENT_ONLINE: '/card/1041/1818/public/signUp/statistics/currentOnlinePopulationStadium',
    WEEKLY_STATS: '/card/1041/1818/public/signUp/statistics/week',
    TIMEOUT: 10000,
};
const GYM_DATA_DIR = path.join(__dirname, '..', 'data');
const GYM_DATA_LOG = path.join(GYM_DATA_DIR, 'dataLog');
const GYM_COLLECT_INTERVAL = 5 * 60 * 1000;

function gymDataLog(event, details = {}) {
    try {
        if (!fs.existsSync(GYM_DATA_DIR)) fs.mkdirSync(GYM_DATA_DIR, { recursive: true });
        fs.appendFileSync(
            GYM_DATA_LOG,
            `${new Date().toISOString()}\t${event}\t${JSON.stringify(details)}\n`,
            'utf8'
        );
    } catch (e) {
        log('err', '健身�?写dataLog失败:', e.message);
    }
}

// ==================== 健身�?数据文件辅助 ====================

async function gymFetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GYM_CONFIG.TIMEOUT);
    try {
        const resp = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
                'Accept': 'application/json, text/plain, */*',
            },
            signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

/** 追加一条人数采样到 data/YYYYMMDD.txt */
function gymSaveSample(count, source = 'unknown') {
    try {
        if (!fs.existsSync(GYM_DATA_DIR)) fs.mkdirSync(GYM_DATA_DIR, { recursive: true });
        const now = new Date();
        const dateKey = String(now.getFullYear()) +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0');
        const timeKey = String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0');
        const line = `${dateKey}${timeKey}-${count}\n`;
        fs.appendFileSync(path.join(GYM_DATA_DIR, `${dateKey}.txt`), line, 'utf8');
        gymDataLog('sample_written', { source, dateKey, timeKey, count });
    } catch (e) {
        log('err', '健身�?写文件失�?', e.message);
    }
}

/** 读取指定日期的数据文件，返回 [{ time, count }] */
function gymReadDay(dateKey) {
    const fp = path.join(GYM_DATA_DIR, `${dateKey}.txt`);
    if (!fs.existsSync(fp)) return [];
    try {
        const text = fs.readFileSync(fp, 'utf8');
        return text.trim().split('\n').filter(Boolean).map(line => {
            const m = line.match(/^(\d{10,12})-(\d+)$/);
            if (!m) return null;
            return { time: m[1].slice(-4), count: parseInt(m[2], 10) };
        }).filter(Boolean);
    } catch { return []; }
}

function gymTimeToMinutes(time) {
    const hours = parseInt(time.slice(0, 2), 10);
    const minutes = parseInt(time.slice(2, 4), 10);
    return hours * 60 + minutes;
}

const LOG_DIR = path.join(__dirname, '..', 'log');
const SERVER_MONITOR_STATE_FILE = process.env.SERVER_MONITOR_STATE_FILE ||
    path.resolve(__dirname, '..', '..', '..', '..', 'last-state.json');

// ==================== 日志 ====================
function log(level, ...args) {
    const ts = new Date().toISOString().slice(11, 19);
    const prefix = { info: 'INFO', ok: 'OK', err: 'ERR', req: 'REQ' }[level] || '-';
    console.log(`[${ts}] ${prefix}`, ...args);
}

// ╔══════════════════════════════════════════════════════════════╗
// �?                   数据流向说明                                �?
// ╠══════════════════════════════════════════════════════════════╣
// �? 前端 fetch('/api/detail?plate=琼A054DB')                     �?
// �?   �?                                                        �?
// �? server.js /api/detail 路由                                   �?
// �?   ├─ queryPlate(plate)     �?海大API getInRecordByPlateNo   �?
// �?   �?  返回: { plate, parkId, enIndexCode(uuid),             �?
// �?   �?          entryTime(createTime), parkName, vehicleType } �?
// �?   �?                                                        �?
// �?   └─ queryBill(plate, parkId, enIndexCode, vehicleType,     �?
// �?                 entryTime)                                   �?
// �?        �?海大API /pms/action/mobile/bill                    �?
// �?        返回: { totalFee(totalCost), paidFee(paidCost),       �?
// �?                unpaidFee(realCost), entryTimeStr(inTime),    �?
// �?                durationMinutes(parkTime),                    �?
// �?                paid(已缴�?), freeMin(剩余免费分钟),         �?
// �?                nextChargeMin/Fee(距下次加�? }               �?
// �?   �?                                                        �?
// �? 前端 renderParkData() 渲染看板                                �?
// �?   ├─ 未缴�? 入场时间 + 停车时长 + 应缴金额 + 48h进度�?      �?
// �?   └─ 已缴�? 剩余免费时间 + 停车时长 + ¥0 + 绿色提示          �?
// ╚══════════════════════════════════════════════════════════════╝

/**
 * [�?步] 查询车牌 �?获取停车记录
 * 调用海大 API: GET /pms/action/mobile/getInRecordByPlateNo
 *   ?plateNo={车牌}&sceneType=pms&regionIndexCode=&time={时间戳}
 *
 * 响应示例: { code:"0", data:[{
 *   carNo:"琼A054DB",        // �?plate
 *   parkId:"76f837a6-...",   // �?缴费URL参数
 *   uuid:"87f37fc7...",      // �?enIndexCode（缴费URL参数�?
 *   createTime:1781275586083,// �?entryTime（入场Unix毫秒时间戳）
 *   parkName:"海南大学海甸校区",
 *   vehicleType:1            // 1=小型�?
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

    // 构造完整返回数�?
    const result = {
        plate: record.carNo || plate,
        parkId: record.parkId || '',
        // enIndexCode �?uuid
        enIndexCode: record.uuid || '',
        // 入场时间戳（毫秒�?
        entryTime: record.createTime || null,
        // 停车场名�?
        parkName: record.parkName || '',
        // 车辆类型
        vehicleType: record.vehicleType || null,
        // 原始记录（保留其他字段备用）
        raw: record,
    };

    log('ok', `parkId=${result.parkId}`);
    log('ok', `enIndexCode=${result.enIndexCode}`);
    log('ok', `入场时间=${result.entryTime ? new Date(result.entryTime).toLocaleString('zh-CN') : '未知'}`);

    return result;
}

/**
 * 创建axios实例（公共请求头�?
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
 * 从API响应中提取第一条停车记�?
 * 响应结构：{ code: "0", data: [{ parkId, uuid, carNo, ... }] }
 */
function getFirstRecord(data) {
    if (!data || typeof data !== 'object') return null;
    const list = data.data || data.result || data.rows || data.records || data.list;
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
}

/**
 * 获取搜索页的session cookie（供后续API调用使用�?
 */
async function getSessionCookie() {
    const client = createClient();
    const resp = await client.get(CONFIG.BASE_URL + CONFIG.SEARCH_PAGE, {
        headers: { 'Referer': CONFIG.BASE_URL + '/' },
    });
    return (resp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}

/**
 * [�?步] 查询停车费用
 * 调用海大 API: GET /pms/action/mobile/bill
 *   ?enRecordIndexCode={uuid} &parkId={parkId}
 *   &exPlateNo={plate} &exVehilceType={type} &time={ts}
 *
 * 响应关键字段:
 *   totalCost     �?总费用（应缴金额�?
 *   paidCost      �?已缴金额
 *   realCost      �?未缴金额�?=已缴完）
 *   parkTime      �?已停分钟�?
 *   inTime        �?入场时间字符�?"2026/06/12 22:46:26"
 *   remainingTime �?缴费后剩余免费分钟数（仅缴费后有值）
 *   type          �?"0"=未缴�?"1"=已缴�?
 *   extraData     �?{ periodEnd(计费周期结束), periodPrice }
 *
 * 本函数额外计�?
 *   paid        �?type==="1" �?(realCost==0 && paidCost>0)
 *   freeMin     �?缴费�?remainingTime 转整�?
 *   nextChargeMin/Fee �?根据计费规则 ¥3@07:00 / ¥2@22:00 计算
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
    // 完整响应保存到文件方便排�?
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

        // 根据实际计费规则计算：�?@07:00 ¥2@22:00交替
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
 * 计费规则�?
 *   白天进场(07-22): <30min免费→�?�?2:00+¥2�?7:00+¥3�?..
 *     关键：过24h周期边界后，下个22:00加�?（新周期夜间费），不是�?
 *   夜间进场(22-07): ¥5�?7:00+¥3�?2:00+¥2�?7:00+¥3�?..
 *     注意：同一24h周期�?2:00加�?，跨周期�?2:00加�?
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

    // 最�?7:00 �?22:00
    const n7 = new Date(now); n7.setHours(7,0,0,0); if (n7<=now) n7.setDate(n7.getDate()+1);
    const n22 = new Date(now); n22.setHours(22,0,0,0); if (n22<=now) n22.setDate(n22.getDate()+1);

    // 22:00 的费用取决于是否�?4h周期边界
    //   同一周期�? ¥2（夜间补充）
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

// 静态文�?
app.use(express.static(path.join(__dirname)));

// 前端首页 - 停车看板
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 便捷面板（看板集合页�?
app.get('/board', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 健康检�?
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==================== 健身�?API 代理 ====================

/**
 * GET /api/gym/current-online
 * 获取健身房当前实时在场人数（API直接返回裸数字）
 */
app.get('/api/gym/current-online', async (req, res) => {
    try {
        const raw = await gymFetchJson(GYM_CONFIG.BASE_URL + GYM_CONFIG.CURRENT_ONLINE);
        const count = typeof raw === 'number' ? raw : parseInt(raw, 10);
        if (!isNaN(count)) {
            gymDataLog('request_success', { source: 'dashboard', count });
            return res.json({ success: true, count, serverTime: Date.now() });
        }
        return res.json({ success: false, count: null, msg: '数据格式异常', raw });
    } catch (err) {
        log('err', '健身�?在线人数查询失败:', err.message);
        gymDataLog('request_failure', { source: 'dashboard', error: err.message });
        return res.status(502).json({ success: false, error: '查询失败: ' + err.message });
    }
});

/**
 * GET /api/gym/today-data
 * 读取当天服务器已持续采集的数据，供本地曲线使用�? */
app.get('/api/gym/today-data', (req, res) => {
    const now = new Date();
    const dateKey = String(now.getFullYear()) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
    return res.json({ success: true, date: dateKey, records: gymReadDay(dateKey) });
});

/**
 * GET /api/gym/yesterday-data
 * 读取昨日记录文件，返�?[{ time: "0900", count: 12 }, ...]
 */
app.get('/api/gym/yesterday-data', (req, res) => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateKey = String(d.getFullYear()) +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');
    let records = gymReadDay(dateKey);
    let fallbackDate = null;

    // 20260729 的真实采集从 10:51 才开始，暂用 20260730 的对应时刻补齐此前曲线。
    // 7 月 31 日起昨日文件就是完整的 20260730，不会进入这个分支。
    if (dateKey === '20260729' && records.length > 0) {
        const firstRealMinute = Math.min(...records.map(r => gymTimeToMinutes(r.time)));
        const fallbackRecords = gymReadDay('20260730')
            .filter(r => gymTimeToMinutes(r.time) < firstRealMinute)
            .map(r => ({ ...r, sourceDate: '20260730' }));
        if (fallbackRecords.length > 0) {
            records = [
                ...fallbackRecords,
                ...records.map(r => ({ ...r, sourceDate: '20260729' })),
            ].sort((a, b) => gymTimeToMinutes(a.time) - gymTimeToMinutes(b.time));
            fallbackDate = '20260730';
        } else {
            records = records.map(r => ({ ...r, sourceDate: '20260729' }));
        }
    }

    return res.json({
        success: true,
        date: dateKey,
        fallbackDate,
        records,
    });
});

/**
 * GET /api/gym/weekly-stats
 * 获取本周各时段签到统计数据（API返回扁平对象�?
 */
app.get('/api/gym/weekly-stats', async (req, res) => {
    try {
        // 返回格式: { "0:00~8:00":44, "8:00~10:00":73, ... }
        const data = await gymFetchJson(GYM_CONFIG.BASE_URL + GYM_CONFIG.WEEKLY_STATS);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const slots = Object.entries(data).map(([timeQuantum, count]) => ({
                timeQuantum, count: Number(count),
            }));
            return res.json({ success: true, slots });
        }
        return res.status(502).json({ success: false, error: '数据格式异常' });
    } catch (err) {
        log('err', '健身�?签到统计查询失败:', err.message);
        return res.status(502).json({ success: false, error: '查询失败: ' + err.message });
    }
});

// 服务器状态面板（本地版）：直接读�?andy 监控器写入的状态文件�?
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
 *   entryTime �?dashboard.html 渲染 "入场时间" �?fmtTs 格式�?
 *   parkName  �?dashboard.html 卡片副标�?
 *   bill.totalFee   �?"应缴金额 ¥X.XX"
 *   bill.durationMinutes �?"停车时长 X小时X�?
 *   bill.entryTimeStr �?"入场时间" 优先使用 bill 返回的字符串
 *   bill.paid / bill.freeMin �?决定渲染"已缴费未驶出"�?停车�?
 *   bill.nextChargeMin/Fee �?"XhXm后加¥X" 倒计�?
 *   payUrl �?"一键缴�?按钮跳转目标
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

        // queryPlate 返回 null �?车辆未入场，前端 renderEmpty() 显示 🚗 + 提示
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

// 缴费API：查询车�?�?返回缴费URL（兼容旧版，用于快捷缴费页）
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

/** 服务端自动采集健身房人数（不依赖前端请求�?*/
let gymCollectTimer = null;
let gymLastSuccessAt = null;

async function gymAutoCollect() {
    const startedAt = Date.now();
    gymDataLog('attempt', { source: 'auto' });
    try {
        const raw = await gymFetchJson(GYM_CONFIG.BASE_URL + GYM_CONFIG.CURRENT_ONLINE);
        const count = typeof raw === 'number' ? raw : parseInt(raw, 10);
        if (!isNaN(count)) {
            const now = Date.now();
            const gapMinutes = gymLastSuccessAt === null ? null : Math.round((now - gymLastSuccessAt) / 60000);
            gymSaveSample(count, 'auto');
            gymDataLog('success', { source: 'auto', count, elapsedMs: now - startedAt, gapMinutes });
            log('ok', '🏋�?自动采集: 人数 =', count);
            gymLastSuccessAt = now;
        } else {
            log('err', '🏋�?自动采集: 数据格式异常 raw =', raw);
            gymDataLog('invalid_response', { source: 'auto', raw });
        }
    } catch (err) {
        log('err', '🏋�?自动采集: 请求失败 -', err.message);
        gymDataLog('failure', { source: 'auto', elapsedMs: Date.now() - startedAt, error: err.message });
    } finally {
        clearTimeout(gymCollectTimer);
        gymCollectTimer = setTimeout(gymAutoCollect, GYM_COLLECT_INTERVAL);
    }
}

app.listen(PORT, () => {
    const lines = [
        '',
        '='.repeat(52),
        '  海大停车场一键缴费 - 代理服务',
        '='.repeat(52),
        `  看板首页: http://localhost:${PORT}`,
        `  查询API:  http://localhost:${PORT}/api/search?plate=琼A054DB`,
        `  详情API:  http://localhost:${PORT}/api/detail?plate=琼A054DB`,
        '='.repeat(52),
        '',
    ];
    console.log(lines.join('\n'));

    // 自动采集：立即执行一次；每次完成后再安排5分钟后的下一次，避免重叠。
    gymDataLog('service_start', { port: PORT, intervalMs: GYM_COLLECT_INTERVAL });
    gymAutoCollect();
    log('info', '健身房自动采集已启动（每5分钟）');

    // 启动日志
    try {
        fs.appendFileSync(
            path.join(LOG_DIR, 'server.log'),
            `[${new Date().toISOString()}] 服务启动 - 端口:${PORT}\n`
        );
    } catch (e) { /* 日志目录可能不存在 */ }
});
