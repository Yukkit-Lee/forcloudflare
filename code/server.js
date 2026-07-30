/**
 * 娴峰ぇ鍋滆溅鍦轰竴閿即璐?- 鍚庣浠ｇ悊鏈嶅姟
 * ============================================
 *
 * 鍔熻兘锛?
 *   鎺ユ敹杞︾墝鍙?鈫?璋冪敤娴峰ぇ鍋滆溅鍦篈PI鏌ヨ 鈫?鎻愬彇 parkId/uuid 鈫?
 *   鏋勯€犵即璐筓RL 鈫?杩斿洖鍓嶇璺宠浆
 *
 * 鐪熷疄API锛?
 *   GET /pms/action/mobile/getInRecordByPlateNo
 *     ?plateNo={杞︾墝}&sceneType=pms&regionIndexCode=&time={鏃堕棿鎴硙
 *
 * 浣跨敤锛?
 *   node server.js                    鍚姩鏈嶅姟
 *   http://localhost:3000             鍓嶇椤甸潰
 *   http://localhost:3000/api/search?plate=鐞糀054DB         API妯″紡
 *   http://localhost:3000/api/search?plate=鐞糀054DB&redirect=1  鐩存帴璺宠浆
 */

const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 閰嶇疆 ====================
const CONFIG = {
    // 娴峰ぇ鍋滆溅鍦烘湇鍔″湴鍧€
    BASE_URL: 'https://hkioc.hainanu.edu.cn',
    // 杞︾墝鏌ヨAPI锛堢敤鎴峰彂鐜扮殑瀹為檯鎺ュ彛锛?
    SEARCH_API: '/pms/action/mobile/getInRecordByPlateNo',
    // 鎼滅储椤甸潰锛堣幏鍙杝ession cookie鐢級
    SEARCH_PAGE: '/pms/carParkMobile/carpayment/search',
    // 璐圭敤鏌ヨAPI
    BILL_API: '/pms/action/mobile/bill',
    // 缂磋垂椤甸潰璺緞鍓嶇紑
    PAY_PATH: '/pms/carParkMobile/carpayment/carpaying/',
    // 璇锋眰瓒呮椂
    TIMEOUT: 15000,
};

// ==================== 鍋ヨ韩鎴?API 閰嶇疆 ====================
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
        log('err', '鍋ヨ韩鎴?鍐檇ataLog澶辫触:', e.message);
    }
}

// ==================== 鍋ヨ韩鎴?鏁版嵁鏂囦欢杈呭姪 ====================

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

/** 杩藉姞涓€鏉′汉鏁伴噰鏍峰埌 data/YYYYMMDD.txt */
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
        log('err', '鍋ヨ韩鎴?鍐欐枃浠跺け璐?', e.message);
    }
}

/** 璇诲彇鎸囧畾鏃ユ湡鐨勬暟鎹枃浠讹紝杩斿洖 [{ time, count }] */
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

// ==================== 鏃ュ織 ====================
function log(level, ...args) {
    const ts = new Date().toISOString().slice(11, 19);
    const prefix = { info: '鈩癸笍', ok: '鉁?, err: '鉂?, req: '馃殫' }[level] || '路';
    console.log(`[${ts}] ${prefix}`, ...args);
}

// 鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽
// 鈺?                   鏁版嵁娴佸悜璇存槑                                鈺?
// 鈺犫晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暎
// 鈺? 鍓嶇 fetch('/api/detail?plate=鐞糀054DB')                     鈺?
// 鈺?   鈫?                                                        鈺?
// 鈺? server.js /api/detail 璺敱                                   鈺?
// 鈺?   鈹溾攢 queryPlate(plate)     鈫?娴峰ぇAPI getInRecordByPlateNo   鈺?
// 鈺?   鈹?  杩斿洖: { plate, parkId, enIndexCode(uuid),             鈺?
// 鈺?   鈹?          entryTime(createTime), parkName, vehicleType } 鈺?
// 鈺?   鈹?                                                        鈺?
// 鈺?   鈹斺攢 queryBill(plate, parkId, enIndexCode, vehicleType,     鈺?
// 鈺?                 entryTime)                                   鈺?
// 鈺?        鈫?娴峰ぇAPI /pms/action/mobile/bill                    鈺?
// 鈺?        杩斿洖: { totalFee(totalCost), paidFee(paidCost),       鈺?
// 鈺?                unpaidFee(realCost), entryTimeStr(inTime),    鈺?
// 鈺?                durationMinutes(parkTime),                    鈺?
// 鈺?                paid(宸茬即璐?), freeMin(鍓╀綑鍏嶈垂鍒嗛挓),         鈺?
// 鈺?                nextChargeMin/Fee(璺濅笅娆″姞閽? }               鈺?
// 鈺?   鈫?                                                        鈺?
// 鈺? 鍓嶇 renderParkData() 娓叉煋鐪嬫澘                                鈺?
// 鈺?   鈹溾攢 鏈即璐? 鍏ュ満鏃堕棿 + 鍋滆溅鏃堕暱 + 搴旂即閲戦 + 48h杩涘害鏉?      鈺?
// 鈺?   鈹斺攢 宸茬即璐? 鍓╀綑鍏嶈垂鏃堕棿 + 鍋滆溅鏃堕暱 + 楼0 + 缁胯壊鎻愮ず          鈺?
// 鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆

/**
 * [绗?姝 鏌ヨ杞︾墝 鈫?鑾峰彇鍋滆溅璁板綍
 * 璋冪敤娴峰ぇ API: GET /pms/action/mobile/getInRecordByPlateNo
 *   ?plateNo={杞︾墝}&sceneType=pms&regionIndexCode=&time={鏃堕棿鎴硙
 *
 * 鍝嶅簲绀轰緥: { code:"0", data:[{
 *   carNo:"鐞糀054DB",        // 鈫?plate
 *   parkId:"76f837a6-...",   // 鈫?缂磋垂URL鍙傛暟
 *   uuid:"87f37fc7...",      // 鈫?enIndexCode锛堢即璐筓RL鍙傛暟锛?
 *   createTime:1781275586083,// 鈫?entryTime锛堝叆鍦篣nix姣鏃堕棿鎴筹級
 *   parkName:"娴峰崡澶у娴风敻鏍″尯",
 *   vehicleType:1            // 1=灏忓瀷杞?
 * }]}
 */
async function queryPlate(plate) {
    const client = createClient();
    const cookies = await getSessionCookie();

    // 璋冪敤鎼滅储API
    log('info', '鏌ヨ杞︾墝:', plate);
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
        log('err', 'API杩斿洖閿欒:', data.msg || '鏈煡閿欒');
        return null;
    }

    const record = getFirstRecord(data);
    if (!record) {
        log('err', '鏈壘鍒板仠杞﹁褰?);
        return null;
    }

    // 鏋勯€犲畬鏁磋繑鍥炴暟鎹?
    const result = {
        plate: record.carNo || plate,
        parkId: record.parkId || '',
        // enIndexCode 鍗?uuid
        enIndexCode: record.uuid || '',
        // 鍏ュ満鏃堕棿鎴筹紙姣锛?
        entryTime: record.createTime || null,
        // 鍋滆溅鍦哄悕绉?
        parkName: record.parkName || '',
        // 杞﹁締绫诲瀷
        vehicleType: record.vehicleType || null,
        // 鍘熷璁板綍锛堜繚鐣欏叾浠栧瓧娈靛鐢級
        raw: record,
    };

    log('ok', `parkId=${result.parkId}`);
    log('ok', `enIndexCode=${result.enIndexCode}`);
    log('ok', `鍏ュ満鏃堕棿=${result.entryTime ? new Date(result.entryTime).toLocaleString('zh-CN') : '鏃?}`);

    return result;
}

/**
 * 鍒涘缓axios瀹炰緥锛堝叕鍏辫姹傚ご锛?
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
 * 浠嶢PI鍝嶅簲涓彁鍙栫涓€鏉″仠杞﹁褰?
 * 鍝嶅簲缁撴瀯锛歿 code: "0", data: [{ parkId, uuid, carNo, ... }] }
 */
function getFirstRecord(data) {
    if (!data || typeof data !== 'object') return null;
    const list = data.data || data.result || data.rows || data.records || data.list;
    if (Array.isArray(list) && list.length > 0) return list[0];
    return null;
}

/**
 * 鑾峰彇鎼滅储椤电殑session cookie锛堜緵鍚庣画API璋冪敤浣跨敤锛?
 */
async function getSessionCookie() {
    const client = createClient();
    const resp = await client.get(CONFIG.BASE_URL + CONFIG.SEARCH_PAGE, {
        headers: { 'Referer': CONFIG.BASE_URL + '/' },
    });
    return (resp.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}

/**
 * [绗?姝 鏌ヨ鍋滆溅璐圭敤
 * 璋冪敤娴峰ぇ API: GET /pms/action/mobile/bill
 *   ?enRecordIndexCode={uuid} &parkId={parkId}
 *   &exPlateNo={plate} &exVehilceType={type} &time={ts}
 *
 * 鍝嶅簲鍏抽敭瀛楁:
 *   totalCost     鈫?鎬昏垂鐢紙搴旂即閲戦锛?
 *   paidCost      鈫?宸茬即閲戦
 *   realCost      鈫?鏈即閲戦锛?=宸茬即瀹岋級
 *   parkTime      鈫?宸插仠鍒嗛挓鏁?
 *   inTime        鈫?鍏ュ満鏃堕棿瀛楃涓?"2026/06/12 22:46:26"
 *   remainingTime 鈫?缂磋垂鍚庡墿浣欏厤璐瑰垎閽熸暟锛堜粎缂磋垂鍚庢湁鍊硷級
 *   type          鈫?"0"=鏈即璐?"1"=宸茬即璐?
 *   extraData     鈫?{ periodEnd(璁¤垂鍛ㄦ湡缁撴潫), periodPrice }
 *
 * 鏈嚱鏁伴澶栬绠?
 *   paid        鈫?type==="1" 鎴?(realCost==0 && paidCost>0)
 *   freeMin     鈫?缂磋垂鍚?remainingTime 杞暣鏁?
 *   nextChargeMin/Fee 鈫?鏍规嵁璁¤垂瑙勫垯 楼3@07:00 / 楼2@22:00 璁＄畻
 */
async function queryBill(plate, parkId, enIndexCode, vehicleType, entryTime) {
    const client = createClient();
    const cookies = await getSessionCookie();

    const timestamp = Date.now();
    log('info', '鏌ヨ璐圭敤...');

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
    // 瀹屾暣鍝嶅簲淇濆瓨鍒版枃浠舵柟渚挎帓鏌?
    fs.writeFileSync(
        path.join(LOG_DIR, 'bill_response.json'),
        JSON.stringify(data, null, 2)
    );
    log('info', '璐圭敤鍝嶅簲宸蹭繚瀛樺埌 log/bill_response.json');
    log('info', '璐圭敤姒傝:', JSON.stringify(data).slice(0, 2000));

    if (data && data.code === '0') {
        const bill = data.data || data;
        // 鍒ゆ柇鏄惁宸茬即璐规湭椹跺嚭
        const paid = bill.type === '1' || (parseFloat(bill.realCost || 0) === 0 && parseFloat(bill.paidCost || 0) > 0);
        const freeMin = paid ? parseInt(bill.remainingTime || 0) : 0;

        // 鏍规嵁瀹為檯璁¤垂瑙勫垯璁＄畻锛毬?@07:00 楼2@22:00浜ゆ浛
        const parkMin = parseInt(bill.parkTime || 0);
        const curFee = bill.totalCost || '0';
        // 宸茬即璐圭姸鎬佷笅锛屼笅娆″姞閽变粠鍏嶈垂鏈熺粨鏉熸椂绠楄捣
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

    log('err', '璐圭敤鏌ヨ澶辫触:', data.msg || data.message);
    return null;
}

/**
 * 璁¤垂瑙勫垯锛?
 *   鐧藉ぉ杩涘満(07-22): <30min鍏嶈垂鈫捖?鈫?2:00+楼2鈫?7:00+楼3鈫?..
 *     鍏抽敭锛氳繃24h鍛ㄦ湡杈圭晫鍚庯紝涓嬩釜22:00鍔犅?锛堟柊鍛ㄦ湡澶滈棿璐癸級锛屼笉鏄?
 *   澶滈棿杩涘満(22-07): 楼5鈫?7:00+楼3鈫?2:00+楼2鈫?7:00+楼3鈫?..
 *     娉ㄦ剰锛氬悓涓€24h鍛ㄦ湡鍐?2:00鍔犅?锛岃法鍛ㄦ湡鍚?2:00鍔犅?
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

    // 24h鍛ㄦ湡杈圭晫锛堜粠鍏ュ満鏃跺埢绠楋級
    const msPer24h = 24 * 3600 * 1000;
    const periodsDone = Math.floor((now - entryTs) / msPer24h);
    const nextPeriodStart = entryTs + (periodsDone + 1) * msPer24h;

    // 鏈€杩?7:00 鍜?22:00
    const n7 = new Date(now); n7.setHours(7,0,0,0); if (n7<=now) n7.setDate(n7.getDate()+1);
    const n22 = new Date(now); n22.setHours(22,0,0,0); if (n22<=now) n22.setDate(n22.getDate()+1);

    // 22:00 鐨勮垂鐢ㄥ彇鍐充簬鏄惁璺?4h鍛ㄦ湡杈圭晫
    //   鍚屼竴鍛ㄦ湡鍐? 楼2锛堝闂磋ˉ鍏咃級
    //   璺ㄥ懆鏈熷悗:   楼5锛堟柊鍛ㄦ湡澶滈棿璐癸級
    const fee22 = n22.getTime() >= nextPeriodStart ? 5 : 2;

    const cand = [{t:n7.getTime(),fee:3},{t:n22.getTime(),fee:fee22}].sort((a,b)=>a.t-b.t);
    const rem = Math.floor((cand[0].t - now) / 60000);
    return rem > 0 ? { min: rem, fee: cand[0].fee } : { min: null, fee: null };
}

/**
 * 鏋勯€犵即璐筓RL
 */
function buildPayUrl(plate, parkId, enIndexCode) {
    return CONFIG.BASE_URL + CONFIG.PAY_PATH +
        encodeURIComponent(plate) +
        '?parkId=' + encodeURIComponent(parkId) +
        '&enIndexCode=' + encodeURIComponent(enIndexCode);
}

// ==================== Express璺敱 ====================

// 闈欐€佹枃浠?
app.use(express.static(path.join(__dirname)));

// 鍓嶇棣栭〉 - 鍋滆溅鐪嬫澘
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 渚挎嵎闈㈡澘锛堢湅鏉块泦鍚堥〉锛?
app.get('/board', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// 鍋ュ悍妫€鏌?
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ==================== 鍋ヨ韩鎴?API 浠ｇ悊 ====================

/**
 * GET /api/gym/current-online
 * 鑾峰彇鍋ヨ韩鎴垮綋鍓嶅疄鏃跺湪鍦轰汉鏁帮紙API鐩存帴杩斿洖瑁告暟瀛楋級
 */
app.get('/api/gym/current-online', async (req, res) => {
    try {
        const raw = await gymFetchJson(GYM_CONFIG.BASE_URL + GYM_CONFIG.CURRENT_ONLINE);
        const count = typeof raw === 'number' ? raw : parseInt(raw, 10);
        if (!isNaN(count)) {
            gymDataLog('request_success', { source: 'dashboard', count });
            return res.json({ success: true, count, serverTime: Date.now() });
        }
        return res.json({ success: false, count: null, msg: '鏁版嵁鏍煎紡寮傚父', raw });
    } catch (err) {
        log('err', '鍋ヨ韩鎴?鍦ㄧ嚎浜烘暟鏌ヨ澶辫触:', err.message);
        gymDataLog('request_failure', { source: 'dashboard', error: err.message });
        return res.status(502).json({ success: false, error: '鏌ヨ澶辫触: ' + err.message });
    }
});

/**
 * GET /api/gym/today-data
 * 璇诲彇褰撳ぉ鏈嶅姟鍣ㄥ凡鎸佺画閲囬泦鐨勬暟鎹紝渚涙湰鍦版洸绾夸娇鐢ㄣ€? */
app.get('/api/gym/today-data', (req, res) => {
    const now = new Date();
    const dateKey = String(now.getFullYear()) +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');
    return res.json({ success: true, date: dateKey, records: gymReadDay(dateKey) });
});

/**
 * GET /api/gym/yesterday-data
 * 璇诲彇鏄ㄦ棩璁板綍鏂囦欢锛岃繑鍥?[{ time: "0900", count: 12 }, ...]
 */
app.get('/api/gym/yesterday-data', (req, res) => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const dateKey = String(d.getFullYear()) +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');
    let records = gymReadDay(dateKey);
    let fallbackDate = null;

    // 20260729 鐨勭湡瀹為噰闆嗕粠 10:51 鎵嶅紑濮嬶紝鏆傜敤 20260730 鐨勫搴旀椂鍒昏ˉ榻愭鍓嶆洸绾裤€?    // 7 鏈?31 鏃ヨ捣鏄ㄦ棩鏂囦欢灏辨槸瀹屾暣鐨?20260730锛屼笉浼氳繘鍏ヨ繖涓垎鏀€?    if (dateKey === '20260729' && records.length > 0) {
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
 * 鑾峰彇鏈懆鍚勬椂娈电鍒扮粺璁℃暟鎹紙API杩斿洖鎵佸钩瀵硅薄锛?
 */
app.get('/api/gym/weekly-stats', async (req, res) => {
    try {
        // 杩斿洖鏍煎紡: { "0:00~8:00":44, "8:00~10:00":73, ... }
        const data = await gymFetchJson(GYM_CONFIG.BASE_URL + GYM_CONFIG.WEEKLY_STATS);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const slots = Object.entries(data).map(([timeQuantum, count]) => ({
                timeQuantum, count: Number(count),
            }));
            return res.json({ success: true, slots });
        }
        return res.status(502).json({ success: false, error: '鏁版嵁鏍煎紡寮傚父' });
    } catch (err) {
        log('err', '鍋ヨ韩鎴?绛惧埌缁熻鏌ヨ澶辫触:', err.message);
        return res.status(502).json({ success: false, error: '鏌ヨ澶辫触: ' + err.message });
    }
});

// 鏈嶅姟鍣ㄧ姸鎬侀潰鏉匡紙鏈湴鐗堬級锛氱洿鎺ヨ鍙?andy 鐩戞帶鍣ㄥ啓鍏ョ殑鐘舵€佹枃浠躲€?
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
            reason: result.reason || '鏆傛棤妫€娴嬬粨鏋?,
            ports: result.ports || {},
            ping: Boolean(result.ping),
        });
    } catch (e) {
        res.status(503).json({
            source: 'local', error: '鏃犳硶璇诲彇鏈嶅姟鍣ㄧ洃鎺х姸鎬佹枃浠?, detail: e.code || e.message,
        });
    }
});

/**
 * [鍓嶇璋冪敤] GET /api/detail?plate=鐞糀054DB
 * 涓茶仈 queryPlate + queryBill锛岃繑鍥炲墠绔覆鏌撴墍闇€鍏ㄩ儴鏁版嵁
 *
 * 杩斿洖瀛楁娴佸悜:
 *   entryTime 鈫?dashboard.html 娓叉煋 "鍏ュ満鏃堕棿" 鎴?fmtTs 鏍煎紡鍖?
 *   parkName  鈫?dashboard.html 鍗＄墖鍓爣棰?
 *   bill.totalFee   鈫?"搴旂即閲戦 楼X.XX"
 *   bill.durationMinutes 鈫?"鍋滆溅鏃堕暱 X灏忔椂X鍒?
 *   bill.entryTimeStr 鈫?"鍏ュ満鏃堕棿" 浼樺厛浣跨敤 bill 杩斿洖鐨勫瓧绗︿覆
 *   bill.paid / bill.freeMin 鈫?鍐冲畾娓叉煋"宸茬即璐规湭椹跺嚭"鎴?鍋滆溅涓?
 *   bill.nextChargeMin/Fee 鈫?"XhXm鍚庡姞楼X" 鍊掕鏃?
 *   payUrl 鈫?"涓€閿即璐?鎸夐挳璺宠浆鐩爣
 */
app.get('/api/detail', async (req, res) => {
    const plate = (req.query.plate || '').trim();

    if (!plate) {
        return res.status(400).json({
            success: false,
            error: '璇锋彁渚涜溅鐗屽彿锛屼緥濡傦細?plate=鐞糀054DB',
        });
    }



    log('req', '鏌ヨ璇︽儏:', plate);

    try {
        const result = await queryPlate(plate);

        // queryPlate 杩斿洖 null 鈫?杞﹁締鏈叆鍦猴紝鍓嶇 renderEmpty() 鏄剧ず 馃殫 + 鎻愮ず
        if (!result) {
            return res.status(404).json({
                success: false,
                error: '鏈壘鍒板仠杞﹁褰曪紝鍙兘杞﹁締涓嶅湪鍋滆溅鍦哄唴',
                plate,
            });
        }

        const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);

        // 鏌ヨ璐圭敤
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
            log('err', '璐圭敤鏌ヨ寮傚父:', e.message);
        }

        // 杩斿洖瀹屾暣鏁版嵁
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
            // 璐圭敤鏁版嵁
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
        log('err', '璇锋眰澶辫触:', err.message);
        return res.status(502).json({
            success: false,
            error: '璇锋眰鍋滆溅鍦烘湇鍔″け璐?,
            plate,
        });
    }
});

// 缂磋垂API锛氭煡璇㈣溅鐗?鈫?杩斿洖缂磋垂URL锛堝吋瀹规棫鐗堬紝鐢ㄤ簬蹇嵎缂磋垂椤碉級
app.get('/api/search', async (req, res) => {
    const plate = (req.query.plate || '').trim();
    const shouldRedirect = req.query.redirect === '1';

    if (!plate) {
        return res.status(400).json({
            success: false,
            error: '璇锋彁渚涜溅鐗屽彿锛屼緥濡傦細?plate=鐞糀054DB',
        });
    }

    log('req', '鏌ヨ杞︾墝:', plate);

    try {
        const result = await queryPlate(plate);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: '鏈壘鍒拌杞︾墝鐨勫仠杞﹁褰曪紝璇风‘璁よ溅杈嗗湪鍋滆溅鍦哄唴',
                plate,
            });
        }

        const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);

        log('ok', '缂磋垂URL宸茬敓鎴?);

        // 鐩存帴璺宠浆妯″紡
        if (shouldRedirect) {
            return res.redirect(302, payUrl);
        }

        // JSON杩斿洖妯″紡
        return res.json({
            success: true,
            plate: result.plate,
            parkId: result.parkId,
            enIndexCode: result.enIndexCode,
            payUrl,
        });

    } catch (err) {
        log('err', '璇锋眰澶辫触:', err.message);
        return res.status(502).json({
            success: false,
            error: '璇锋眰鍋滆溅鍦烘湇鍔″け璐ワ紝璇风◢鍚庨噸璇?,
            plate,
        });
    }
});

// ==================== 鍚姩 ====================

/** 鏈嶅姟绔嚜鍔ㄩ噰闆嗗仴韬埧浜烘暟锛堜笉渚濊禆鍓嶇璇锋眰锛?*/
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
            log('ok', '馃弸锔?鑷姩閲囬泦: 浜烘暟 =', count);
            gymLastSuccessAt = now;
        } else {
            log('err', '馃弸锔?鑷姩閲囬泦: 鏁版嵁鏍煎紡寮傚父 raw =', raw);
            gymDataLog('invalid_response', { source: 'auto', raw });
        }
    } catch (err) {
        log('err', '馃弸锔?鑷姩閲囬泦: 璇锋眰澶辫触 -', err.message);
        gymDataLog('failure', { source: 'auto', elapsedMs: Date.now() - startedAt, error: err.message });
    } finally {
        clearTimeout(gymCollectTimer);
        gymCollectTimer = setTimeout(gymAutoCollect, GYM_COLLECT_INTERVAL);
    }
}

app.listen(PORT, () => {
    const lines = [
        '',
        '鈺?.repeat(52),
        '  馃吙锔? 娴峰ぇ鍋滆溅鍦轰竴閿即璐?- 浠ｇ悊鏈嶅姟',
        '鈺?.repeat(52),
        `  鐪嬫澘棣栭〉: http://localhost:${PORT}`,
        `  鏌ヨAPI:  http://localhost:${PORT}/api/search?plate=鐞糀054DB`,
        `  璇︽儏API:  http://localhost:${PORT}/api/detail?plate=鐞糀054DB`,
        '鈺?.repeat(52),
        '',
    ];
    console.log(lines.join('\n'));

    // 鑷姩閲囬泦锛氱珛鍗虫墽琛屼竴娆★紱姣忔瀹屾垚鍚庡啀瀹夋帓5鍒嗛挓鍚庣殑涓嬩竴娆★紝閬垮厤閲嶅彔銆?    gymDataLog('service_start', { port: PORT, intervalMs: GYM_COLLECT_INTERVAL });
    gymAutoCollect();
    log('info', '馃弸锔?鍋ヨ韩鎴胯嚜鍔ㄩ噰闆嗗凡鍚姩锛堟瘡5鍒嗛挓锛?);

    // 鍚姩鏃ュ織
    try {
        fs.appendFileSync(
            path.join(LOG_DIR, 'server.log'),
            `[${new Date().toISOString()}] 鏈嶅姟鍚姩 - 绔彛:${PORT}\n`
        );
    } catch (e) { /* 鏃ュ織鐩綍鍙兘涓嶅瓨鍦?*/ }
});
