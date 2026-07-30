/**
 * 婵犵數鍋炲娆撳床閺屻儱桅闁搞儺鍓欑壕缁樼節婵犲倹顥炵紒銊у█閺屾盯鏁冩担骞库偓鍐磼閺冣偓閹告娊寮婚妸鈺婃晩闁诡垎鍐偖闂?- Cloudflare Worker
 * ============================================
 * 闂傚倷绶￠崰鎾诲礉鎼达絾濯? npx wrangler deploy
 */

// ==================== 闂傚倷鐒﹀妯肩矓閸洘鍋?====================
const CONFIG = {
    BASE_URL: 'https://hkioc.hainanu.edu.cn',
    SEARCH_PAGE: '/pms/carParkMobile/carpayment/search',
    SEARCH_API: '/pms/action/mobile/getInRecordByPlateNo',
    BILL_API: '/pms/action/mobile/bill',
    PAY_PATH: '/pms/carParkMobile/carpayment/carpaying/',
    TIMEOUT: 12000,
};

const GYM_CONFIG = {
    BASE_URL: 'https://api.sbooy.com',
    CURRENT_ONLINE: '/card/1041/1818/public/signUp/statistics/currentOnlinePopulationStadium',
    TIMEOUT: 10000,
};

// ==================== HTTP闂佽楠哥粻宥夊垂濞差亜鏄ユ繛鎴炴皑閸楁碍銇勯弽銉モ偓妤冪矆閸曨垱鐓涢柛銉戜椒绮ч梺鍝ュ仧閹窊ios闂?====================
async function fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);
    try {
        const resp = await fetch(url, { ...opts, signal: controller.signal });
        return resp;
    } finally {
        clearTimeout(timer);
    }
}

async function getSessionCookie() {
    const resp = await fetchWithTimeout(CONFIG.BASE_URL + CONFIG.SEARCH_PAGE, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': CONFIG.BASE_URL + '/',
        },
    });
    // 濠电偛顕慨鏉懨洪悗宄?Cookie濠电姰鍨煎▔娑㈡偤閵娿劊浜瑰〒姘ｅ亾鐎规洩缍佸鐢电紦閻氱牰ie闂佽瀛╃粙鎺椼€冮崼銉晞濞达絽婀遍埢?
    const setCookie = resp.headers.get('set-cookie') || '';
    return setCookie.split(',').map(c => c.trim().split(';')[0]).filter(Boolean).join('; ');
}

// ==================== API闂備礁鎼悮顐﹀磿閹绢噮鏁?====================
async function queryPlate(plate) {
    const cookies = await getSessionCookie();
    const ts = Date.now();

    const url = CONFIG.BASE_URL + CONFIG.SEARCH_API +
        '?plateNo=' + encodeURIComponent(plate) +
        '&sceneType=pms&regionIndexCode=&time=' + ts;

    const resp = await fetchWithTimeout(url, {
        headers: {
            'Cookie': cookies,
            'Referer': CONFIG.BASE_URL + CONFIG.SEARCH_PAGE,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
        },
    });

    const data = await resp.json();
    if (data.code !== '0' || !data.data || !data.data.length) return null;

    const r = data.data[0];
    return {
        plate: r.carNo || plate,
        parkId: r.parkId || '',
        enIndexCode: r.uuid || '',
        entryTime: r.createTime || null,
        parkName: r.parkName || '',
        vehicleType: r.vehicleType || null,
    };
}

async function queryBill(plate, parkId, enIndexCode, vehicleType, entryTime) {
    const cookies = await getSessionCookie();
    const ts = Date.now();

    const url = CONFIG.BASE_URL + CONFIG.BILL_API +
        '?enRecordIndexCode=' + encodeURIComponent(enIndexCode) +
        '&parkId=' + encodeURIComponent(parkId) +
        '&exPlateNo=' + encodeURIComponent(plate) +
        '&exVehilceType=' + (vehicleType || 1) +
        '&time=' + ts;

    const resp = await fetchWithTimeout(url, {
        headers: {
            'Cookie': cookies,
            'Referer': CONFIG.BASE_URL + CONFIG.SEARCH_PAGE,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
        },
    });

    const data = await resp.json();
    if (data.code !== '0' || !data.data) return null;

    const bill = data.data;
    const paid = bill.type === '1' || (parseFloat(bill.realCost || 0) === 0 && parseFloat(bill.paidCost || 0) > 0);
    const freeMin = paid ? parseInt(bill.remainingTime || 0) : 0;
    const parkMin = parseInt(bill.parkTime || 0);
    const curFee = bill.totalCost || '0';
    const calcEntry = paid && freeMin > 0 ? Date.now() + freeMin * 60000 : (entryTime || Date.now());
    const ni = calcNextCharge(calcEntry, paid ? 0 : parkMin, paid ? '0' : curFee);

    return {
        totalFee: bill.totalCost || null,
        paidFee: bill.paidCost || null,
        unpaidFee: bill.realCost || null,
        durationMinutes: bill.parkTime || null,
        entryTimeStr: bill.inTime || null,
        chargeRuleName: bill.chargeRuleName || '',
        paid,
        freeMin,
        nextChargeMin: ni.min,
        nextChargeFee: ni.fee,
    };
}

const TZ=8;
function cnMins(t){const d=new Date(t+TZ*3600000);return d.getUTCHours()*60+d.getUTCMinutes()}
function nextCN(now,hour){const t=hour*60,cur=cnMins(now);let d=t-cur;if(d<=0)d+=1440;return now+d*60000}
function calcNextCharge(entryTs,parkMin,currentFee){
    if(!entryTs)return{min:null,fee:null};
    const now=Date.now(),h=new Date(entryTs+TZ*3600000).getUTCHours(),isNight=h>=22||h<7;
    const feeNum=parseFloat(currentFee)||0,elapsed=parkMin||0;
    if(feeNum===0){if(isNight)return{min:0,fee:5};if(elapsed<30)return{min:30-elapsed,fee:3};return{min:0,fee:3}}
    const n7=nextCN(now,7),n22=nextCN(now,22);
    // 22:00闂佽崵濮甸崝鏇烇耿闁秴鏋侀柕鍫濐槸閻鏌″畵顔煎暞閻庮偅绻涚€涙鐭婇悗娑掓櫅鍗遍柟闂寸鐟欙箓鏌ㄩ弴姘卞妽缁?4h闂備礁鎲＄粙蹇涘礉瀹ュ拑鑰块柍鈺佸暞缂嶅洭鏌涢敂璇插箺婵炲懏娲熼弻銊モ槈濞嗘帒顥濋梺璇″枟閹歌崵绮欐径鎰劦妞ゆ帒瀚婵嬫煏婵犲繘妾柛鈺佸€块弻娑㈠箛椤掍礁浠?闂備焦瀵х粙鎴︽儗娴ｇ硶鏋栭柡鍥ュ灩瀹告繈鏌曟繝蹇涙闁糕晛鍊块弻娑橆潩椤掑倻妲?
    const ms24=86400000,periodsDone=Math.floor((now-entryTs)/ms24),nextPeriod=entryTs+(periodsDone+1)*ms24;
    const fee22=n22>=nextPeriod?5:2;
    const cand=[{t:n7,fee:3},{t:n22,fee:fee22}].sort((a,b)=>a.t-b.t);
    const rem=Math.floor((cand[0].t-now)/60000);
    return rem>0?{min:rem,fee:cand[0].fee}:{min:null,fee:null};
}

function buildPayUrl(plate, parkId, enIndexCode) {
    return CONFIG.BASE_URL + CONFIG.PAY_PATH +
        encodeURIComponent(plate) +
        '?parkId=' + encodeURIComponent(parkId) +
        '&enIndexCode=' + encodeURIComponent(enIndexCode);
}

// ==================== JSON闂備礁鎲＄换鍌滅矓鐎垫瓕濮?====================
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

// ==================== Gym D1 monitor ====================
function chinaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).reduce((out, part) => {
        if (part.type !== 'literal') out[part.type] = part.value;
        return out;
    }, {});
    return parts.year + '-' + parts.month + '-' + parts.day;
}

async function writeGymApiLog(env, entry) {
    const requestedAt = entry.requestedAt || new Date().toISOString();
    const record = {
        requestedAt,
        requestDate: chinaDateKey(new Date(requestedAt)),
        requestType: entry.requestType,
        upstreamStatus: entry.upstreamStatus ?? null,
        success: Boolean(entry.success),
        durationMs: entry.durationMs,
        errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null,
    };

    console.log(JSON.stringify({ event: 'gym_api_access', ...record }));
    if (!env.GYM_DB) return;

    try {
        await env.GYM_DB.prepare(
            `INSERT INTO gym_api_logs
                (requested_at, request_date, request_type, upstream_status, success, duration_ms, error_message)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            record.requestedAt,
            record.requestDate,
            record.requestType,
            record.upstreamStatus,
            record.success ? 1 : 0,
            record.durationMs,
            record.errorMessage
        ).run();
    } catch (error) {
        console.error('gym api log D1 write failed', error);
    }
}

async function fetchGymOnlineCount(env, requestType) {
    const requestedAt = new Date().toISOString();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GYM_CONFIG.TIMEOUT);
    let upstreamStatus = null;
    try {
        const response = await fetch(GYM_CONFIG.BASE_URL + GYM_CONFIG.CURRENT_ONLINE, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'jinshugou-gym-worker/1.0' },
            signal: controller.signal,
        });
        upstreamStatus = response.status;
        if (!response.ok) throw new Error('gym upstream HTTP ' + response.status);
        const count = extractGymCount(await response.json());
        await writeGymApiLog(env, {
            requestedAt,
            requestType,
            upstreamStatus,
            success: true,
            durationMs: Date.now() - startedAt,
        });
        return count;
    } catch (error) {
        const errorMessage = error?.name === 'AbortError'
            ? 'gym upstream timeout after ' + GYM_CONFIG.TIMEOUT + 'ms'
            : error?.message || String(error);
        await writeGymApiLog(env, {
            requestedAt,
            requestType,
            upstreamStatus,
            success: false,
            durationMs: Date.now() - startedAt,
            errorMessage,
        });
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function extractGymCount(payload) {
    if (typeof payload === 'number' && Number.isFinite(payload) && payload >= 0) return Math.round(payload);
    const candidates = [payload?.data?.onlineNum, payload?.data?.onlineCount,
        payload?.data?.currentOnlinePopulation, payload?.onlineNum, payload?.onlineCount,
        payload?.currentOnlinePopulation];
    const count = candidates.map(Number).find(value => Number.isFinite(value) && value >= 0);
    if (count == null) throw new Error('gym upstream returned no online count');
    return Math.round(count);
}

async function collectGymSample(env) {
    if (!env.GYM_DB) throw new Error('GYM_DB binding is missing');
    const count = await fetchGymOnlineCount(env, 'worker-cron');
    const sampledAt = new Date().toISOString();
    const sampleDate = chinaDateKey(new Date(sampledAt));
    await env.GYM_DB.prepare(
        'INSERT INTO gym_samples (sampled_at, sample_date, online_count, source) VALUES (?, ?, ?, ?) ON CONFLICT(sampled_at) DO NOTHING'
    ).bind(sampledAt, sampleDate, count, 'worker-cron').run();
    return { sampledAt, sampleDate, onlineCount: count };
}

async function getGymSamples(env, date, since) {
    if (!env.GYM_DB) return json({ success: false, error: 'GYM_DB binding is missing' }, 503);
    const query = since
        ? 'SELECT sampled_at, online_count, source FROM gym_samples WHERE sample_date = ? AND sampled_at > ? ORDER BY sampled_at ASC'
        : 'SELECT sampled_at, online_count, source FROM gym_samples WHERE sample_date = ? ORDER BY sampled_at ASC';
    const statement = since ? env.GYM_DB.prepare(query).bind(date, since) : env.GYM_DB.prepare(query).bind(date);
    const result = await statement.all();
    return json({ success: true, date, records: (result.results || []).map(row => {
        const localTime = new Date(row.sampled_at);
        return {
            sampledAt: row.sampled_at,
            onlineCount: row.online_count,
            source: row.source,
            time: String(localTime.getUTCHours() + 8 >= 24 ? localTime.getUTCHours() + 8 - 24 : localTime.getUTCHours() + 8).padStart(2, '0') + String(localTime.getUTCMinutes()).padStart(2, '0'),
            count: row.online_count,
        };
    }) });
}

async function getGymLatest(env) {
    if (!env.GYM_DB) return json({ success: false, error: 'GYM_DB binding is missing' }, 503);
    const result = await env.GYM_DB.prepare(
        'SELECT sampled_at, sample_date, online_count, source FROM gym_samples ORDER BY sampled_at DESC LIMIT 1'
    ).all();
    const row = result.results?.[0];
    return json({ success: true, record: row ? {
        sampledAt: row.sampled_at, date: row.sample_date, onlineCount: row.online_count, source: row.source,
    } : null });
}

async function getGymCurrentOnline(env) {
    try {
        const count = await fetchGymOnlineCount(env, 'realtime-refresh');
        return json({ success: true, count, serverTime: Date.now(), source: 'realtime-refresh' });
    } catch (error) {
        return json({ success: false, count: null, error: 'gym realtime request failed' }, 502);
    }
}

async function getGymApiLogs(env, url) {
    if (!env.GYM_DB) return json({ success: false, error: 'GYM_DB binding is missing' }, 503);
    const date = url.searchParams.get('date');
    const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '100', 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
    const query = date
        ? `SELECT requested_at, request_date, request_type, upstream_status, success,
                  duration_ms, error_message
           FROM gym_api_logs WHERE request_date = ? ORDER BY requested_at DESC LIMIT ?`
        : `SELECT requested_at, request_date, request_type, upstream_status, success,
                  duration_ms, error_message
           FROM gym_api_logs ORDER BY requested_at DESC LIMIT ?`;
    const statement = date
        ? env.GYM_DB.prepare(query).bind(date, limit)
        : env.GYM_DB.prepare(query).bind(limit);
    const result = await statement.all();
    return json({
        success: true,
        date: date || null,
        records: (result.results || []).map(row => ({
            requestedAt: row.requested_at,
            requestDate: row.request_date,
            requestType: row.request_type,
            upstreamStatus: row.upstream_status,
            success: Boolean(row.success),
            durationMs: row.duration_ms,
            errorMessage: row.error_message,
        })),
    });
}

async function handleGymApi(path, url, env) {
    const today = chinaDateKey();
    if (path === '/api/gym/latest') return getGymLatest(env);
    if (path === '/api/gym/current-online') return getGymCurrentOnline(env);
    if (path === '/api/gym/api-logs') return getGymApiLogs(env, url);
    if (path === '/api/gym/today-data') return getGymSamples(env, url.searchParams.get('date') || today, url.searchParams.get('since'));
    if (path === '/api/gym/today') return getGymSamples(env, url.searchParams.get('date') || today, url.searchParams.get('since'));
    if (path === '/api/gym/yesterday') {
        const date = new Date(Date.now() - 86400000);
        return getGymSamples(env, url.searchParams.get('date') || chinaDateKey(date), url.searchParams.get('since'));
    }
    if (path === '/api/gym/yesterday-data') {
        const date = new Date(Date.now() - 86400000);
        return getGymSamples(env, url.searchParams.get('date') || chinaDateKey(date), url.searchParams.get('since'));
    }
    if (path === '/api/gym/weekly-stats') return json({ success: true, slots: [] });
    return null;
}

// ==================== 闂備礁鎼悧鍡欑矓鐎涙ɑ鍙忛柣鏃傚帶闂傤垶鏌曟繛褍鍞敃鍌涚厵?KV ====================
// Andy 闂傚倷绶￠崑鍛┍閾忚宕?HMAC 缂傚倷鐒︾粙鎺楀磿閹惰棄绠栭柡鍥ュ灩鐟欙箓鏌熺€电浠﹂柟?Worker 濠电偞鍨堕幐鎼佹晝閵夛附鍙忛柕鍫濐槹閺咁剟鎮楀☉姘 闂備礁鎲￠悷顖涚濞嗘垶宕叉慨妯诲閸嬫挸鈽夊▍铏灥閵嗘帡宕奸弴鐐搭棟婵☆偊顣﹂懗鍫曨敂閸楃伝褰掓偐閸偅鐝繝娈垮枟閹倿鐛埀顒€霉閿濆浂鏆柛?
const textEncoder = new TextEncoder();

function hexToBytes(value) {
    if (!/^[0-9a-f]{64}$/i.test(value || '')) return null;
    const bytes = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

async function verifyServerReport(request, body, env) {
    const timestamp = request.headers.get('X-Monitor-Timestamp');
    const signature = hexToBytes(request.headers.get('X-Monitor-Signature'));
    if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !env.INGEST_HMAC_KEY) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    const prefix = textEncoder.encode(timestamp + '.');
    const signed = new Uint8Array(prefix.length + body.length);
    signed.set(prefix); signed.set(body, prefix.length);
    const key = await crypto.subtle.importKey(
        'raw', textEncoder.encode(env.INGEST_HMAC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    return crypto.subtle.verify('HMAC', key, signature.buffer, signed.buffer);
}

function isServerReport(data) {
    return data && data.schema_version === 1 && typeof data.host === 'string'
        && typeof data.reported_at === 'string' && typeof data.status === 'string'
        && typeof data.connectivity === 'string' && typeof data.last_confirmed_os === 'string'
        && typeof data.reason === 'string' && typeof data.ports === 'object';
}

async function receiveServerReport(request, env) {
    if (!env.SERVER_STATUS) return json({ error: '闂備礁鎼悧婊勭閻愰潧鍨濋柨鏃堟暜閸?SERVER_STATUS KV Namespace' }, 503);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length === 0 || body.length > 16384 || !await verifyServerReport(request, body, env)) {
        return json({ error: 'unauthorized' }, 401);
    }
    try {
        const report = JSON.parse(new TextDecoder().decode(body));
        if (!isServerReport(report)) return json({ error: 'invalid_report' }, 400);
        await env.SERVER_STATUS.put('latest', JSON.stringify(report));
        return json({ ok: true });
    } catch (e) {
        return json({ error: 'invalid_json' }, 400);
    }
}

async function getServerStatus(env) {
    if (!env.SERVER_STATUS) return json({ error: '闂備礁鎼悧婊勭閻愰潧鍨濋柨鏃堟暜閸?SERVER_STATUS KV Namespace' }, 503);
    const text = await env.SERVER_STATUS.get('latest');
    if (!text) return json({ error: 'server status unavailable' }, 404);
    try {
        const report = JSON.parse(text);
        const checkedMs = Date.parse(report.reported_at);
        return json({
            source: 'worker-kv',
            host: report.host || null,
            connectivity: !Number.isFinite(checkedMs) || Date.now() - checkedMs > 5 * 60 * 1000
                ? 'STALE' : (report.connectivity || 'UNKNOWN'),
            last_confirmed_os: report.last_confirmed_os || 'UNKNOWN',
            status: report.status || 'UNKNOWN',
            checked_at: report.reported_at || null,
            last_state_change_at: report.last_state_change_at || null,
            consecutive_offline_count: report.consecutive_offline_count || 0,
            reason: report.reason || 'no reason',
            ports: report.ports || {},
            ping: Boolean(report.ping),
        });
    } catch (e) {
        return json({ error: 'invalid server status in KV' }, 500);
    }
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: 闂備胶顭堥鍐磿闁秴绠栫€广儱鎲樺☉銏犵劦妞ゆ帒瀚拑?
    if (path === '/api/health') {
        return json({ status: 'ok', time: new Date().toISOString() });
    }

    if (path === '/api/server-report' && request.method === 'POST') return receiveServerReport(request, env);
    if (path === '/api/server-status' && request.method === 'GET') return getServerStatus(env);
    if (request.method === 'GET' && path.startsWith('/api/gym/')) {
        try {
            const response = await handleGymApi(path, url, env);
            if (response) return response;
        } catch (e) {
            return json({ success: false, error: '闂備胶顭堥鍐磿閹绢喗顥婇柍鍝勬噹缁狅綁鏌熺粙鍨劉婵炲牆鐖奸弻鐔烘嫚閳ヨ櫕鐏嶉梺缁樻惈缁辨洟骞忛悩璇差潊闁绘﹩鍠曢弶顓㈡煟? ' + e.message }, 502);
        }
    }

    // API: 闂佸搫顦遍崕鎴炰繆閸ャ劍娅犳繝闈涚墛鐎氭岸鏌ㄩ弮鍥棄闁?
    if (path === '/api/detail') {
        const plate = url.searchParams.get('plate')?.trim();
        if (!plate) return json({ success: false, error: 'plate required' }, 400);

        try {
            const result = await queryPlate(plate);
            if (!result) return json({ success: false, error: 'record not found' }, 404);

            const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);
            let bill = null;
            try {
                bill = await queryBill(result.plate, result.parkId, result.enIndexCode, result.vehicleType, result.entryTime);
            } catch (e) { /* 闂佽崵濮甸崝鏇烇耿闁秴鏋侀柕鍫濐槸閽冪喖鏌曟径妯煎帥闁搞倕瀚…鍧楀箚閹殿喚缈遍柣鐔哥懕闂勫嫮绮欐径濠庡悑濠㈣泛顑傞弸搴ㄦ⒑?*/ }

            return json({
                success: true,
                plate: result.plate,
                parkId: result.parkId,
                enIndexCode: result.enIndexCode,
                entryTime: result.entryTime,
                parkName: result.parkName,
                vehicleType: result.vehicleType,
                payUrl,
                serverTime: Date.now(),
                bill: bill || null,
            });
        } catch (e) {
            return json({ success: false, error: '闂佽崵濮村ú顓㈠绩闁秵鍎戦柣妤€鐗嗙欢鐐哄级閸偄浜悮? ' + e.message }, 502);
        }
    }

    // API: 闂備胶鎳撻崥瀣垝鎼淬劌纾?缂傚倸鍊搁崐濠毸夐幇鏉垮瀭闁稿本绮嶅畷澶愭倵閸︻厼校缂?
    if (path === '/api/search') {
        const plate = url.searchParams.get('plate')?.trim();
        const redirect = url.searchParams.get('redirect') === '1';
        if (!plate) return json({ success: false, error: 'plate required' }, 400);

        try {
            const result = await queryPlate(plate);
            if (!result) return json({ success: false, error: 'record not found' }, 404);

            const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);
            if (redirect) return Response.redirect(payUrl, 302);
            return json({ success: true, plate, parkId: result.parkId, enIndexCode: result.enIndexCode, payUrl });
        } catch (e) {
            return json({ success: false, error: '闂佽崵濮村ú顓㈠绩闁秵鍎戦柣妤€鐗嗙欢鐐哄级閸偄浜悮? ' + e.message }, 502);
        }
    }

    // 闂傚倸鍊搁悧濠囨偡閿曞倸鐒垫い鎴ｆ硶缁愭棃鏌曢崱妤婃█婵? 闂備焦妞挎禍婊堫敄閸℃鐔?
    if (path === '/' || path === '/board') {
        return new Response(DASHBOARD_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }

    // 404
    return json({ error: 'Not Found' }, 404);
}

// ==================== 闂備礁鎲￠崙褰掑垂閻楀牊鍙?====================
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(collectGymSample(env).catch(error => console.error('gym cron failed', error)));
    },
};

// ==================== 闂備礁鎲￠崝鏇㈠箠鎼达絿鐭堢紒鈧張顥矻闂備焦瀵х粙鎴濓耿閹测偓oudflare Workers濠电偞鍨堕幐鍝ョ矓閻㈢鏋佹い鏇楀亾妤犵偞鍔栫粙濠囨偝閹间焦鍋ｉ柛銉憾閸ゆ瑧鎲搁弶鎸庡枠鐎殿噮鍓熷畷鍫曟晜缁涘浠洪梻?====================
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>便捷面板</title>
    <style>
        :root {
            --bg: #f2f3f7;
            --card: #ffffff;
            --text: #1d1d2b;
            --sub: #8e8ea0;
            --border: #ebeef2;
            --radius: 16px;
            --shadow: 0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.06);
            --blue: #2563eb;
            --blue-bg: #eff4ff;
            --green: #16a34a;
            --green-bg: #f0faf3;
            --amber: #d97706;
            --amber-bg: #fffbeb;
            --red: #dc2626;
            --red-bg: #fef2f2;
            --purple: #7c3aed;
            --purple-bg: #f5f3ff;
        }
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 20px 16px 40px;
            -webkit-tap-highlight-color: transparent;
            -webkit-font-smoothing: antialiased;
        }
        .container { max-width: 960px; margin: 0 auto; }

        /* ====== 头部 ====== */
        .header {
            text-align: center; padding: 16px 0 24px;
        }
        .header .avatar {
            width: 48px; height: 48px;
            background: linear-gradient(135deg, #2563eb, #7c3aed);
            border-radius: 14px; display: inline-flex;
            align-items: center; justify-content: center;
            font-size: 24px; margin-bottom: 8px;
            box-shadow: 0 4px 12px rgba(37,99,235,.25);
        }
        .header h1 { font-size: 20px; font-weight: 700; letter-spacing: -.3px; }
        .header p { font-size: 13px; color: var(--sub); margin-top: 2px; }

        /* ====== 卡片网格 ====== */
        .grid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 14px;
        }
        /* 电脑端：一行两个面板 */
        @media (min-width: 640px) {
            .grid { grid-template-columns: 1fr 1fr; }
        }

        /* ====== 卡片 ====== */
        .card {
            background: var(--card);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            overflow: hidden;
            transition: box-shadow .2s;
        }
        .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); }
        .card-header {
            display: flex; align-items: center; gap: 10px;
            padding: 14px 18px 0;
        }
        .card-icon {
            width: 36px; height: 36px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; flex-shrink: 0;
        }
        .card-icon.blue  { background: var(--blue-bg);  }
        .card-icon.green { background: var(--green-bg); }
        .card-icon.purple{ background: var(--purple-bg);}
        .card-icon.amber { background: var(--amber-bg); }
        .card-title { font-size: 14px; font-weight: 700; }
        .card-sub   { font-size: 11px; color: var(--sub); }
        .card-body  { padding: 14px 18px 18px; }

        /* ====== 停车看板 ====== */
        .plate-row {
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 14px;
        }
        .plate-tag {
            display: inline-block;
            background: #1a1a2e;
            color: #fff;
            font-size: 18px; font-weight: 800;
            letter-spacing: 3px;
            padding: 6px 18px; border-radius: 8px;
            font-family: "PingFang SC", "Microsoft YaHei", monospace;
        }
        .park-status {
            display: flex; align-items: center; gap: 5px;
            font-size: 12px; font-weight: 600;
        }
        .park-status .dot {
            width: 7px; height: 7px; border-radius: 50%;
        }
        .park-status.parked .dot { background: var(--green); animation: pulse-dot 2s infinite; }
        .park-status.absent .dot { background: var(--red); }
        .park-status.parked { color: var(--green); }
        .park-status.absent { color: var(--red); }
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.35} }

        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 14px;
        }
        .info-item {
            background: #f8f9fb;
            border-radius: 10px;
            padding: 10px 12px;
        }
        .info-item .label {
            font-size: 10px; color: var(--sub);
            text-transform: uppercase; letter-spacing: .5px;
            margin-bottom: 2px;
        }
        .info-item .value {
            font-size: 14px; font-weight: 700;
            font-variant-numeric: tabular-nums;
        }
        .info-item .value.fee {
            font-size: 18px;
            color: var(--red);
        }

        /* 48h 进度条 */
        .limit-bar { margin-bottom: 14px; }
        .limit-bar .labels {
            display: flex; justify-content: space-between;
            font-size: 10px; color: #aaa; margin-bottom: 4px;
        }
        .limit-bar .track {
            height: 6px; background: #e8eaed; border-radius: 3px;
            overflow: hidden;
        }
        .limit-bar .fill {
            height: 100%; border-radius: 3px;
            transition: width 1s linear;
        }
        .limit-bar .fill.safe   { background: var(--green); }
        .limit-bar .fill.alert  { background: var(--amber); }
        .limit-bar .fill.danger { background: var(--red); }

        .limit-msg {
            font-size: 11px; font-weight: 600;
            padding: 6px 10px; border-radius: 6px;
            text-align: center;
        }
        .limit-msg.safe   { background: var(--green-bg); color: var(--green); }
        .limit-msg.alert  { background: var(--amber-bg); color: var(--amber); }
        .limit-msg.danger { background: var(--red-bg); color: var(--red); }

        /* 按钮 */
        .btn {
            display: flex; align-items: center; justify-content: center;
            gap: 6px; width: 100%; padding: 12px 20px;
            font-size: 14px; font-weight: 700;
            border: none; border-radius: 12px; cursor: pointer;
            transition: all .15s; letter-spacing: .5px;
        }
        .btn:active { transform: scale(.97); }
        .btn-pay {
            background: var(--green);
            color: #fff;
            box-shadow: 0 2px 8px rgba(22,163,74,.3);
        }
        .btn-pay:hover { box-shadow: 0 4px 14px rgba(22,163,74,.4); }
        .btn-outline {
            background: #fff; color: var(--text);
            border: 1px solid var(--border);
        }

        /* ====== 占位卡片 ====== */
        .placeholder-card {
            background: var(--card);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            min-height: 160px;
            border: 2px dashed #e2e4ea;
            cursor: default;
            transition: border-color .2s;
        }
        .placeholder-card:hover { border-color: #c8cbd4; }
        .placeholder-card .icon { font-size: 32px; margin-bottom: 6px; }
        .placeholder-card .title { font-size: 13px; font-weight: 600; color: #aaa; }
        .placeholder-card .hint { font-size: 11px; color: #ccc; margin-top: 2px; }
        .status-pill { display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:999px; font-size:11px; font-weight:800; }
        .status-pill.online { background:var(--green-bg); color:var(--green); }
        .status-pill.offline { background:var(--red-bg); color:var(--red); }
        .status-pill.stale, .status-pill.unknown { background:var(--amber-bg); color:var(--amber); }
        .port-list { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
        .port-chip { font-size:10px; font-weight:700; padding:4px 7px; background:#f4f5f7; border-radius:6px; color:var(--sub); }
        .port-chip.open { color:var(--green); background:var(--green-bg); }

        /* ====== 健身房监控 ====== */
        .gym-stat {
            text-align: center; padding: 6px 0 12px;
        }
        .gym-stat .big-num {
            font-size: 52px; font-weight: 900;
            font-variant-numeric: tabular-nums;
            line-height: 1.1;
            background: linear-gradient(135deg, #2563eb, #7c3aed);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .gym-stat .big-num.loading {
            background: none;
            -webkit-text-fill-color: #ccc;
            color: #ccc;
        }
        .gym-stat .label {
            font-size: 12px; color: var(--sub); margin-top: 2px;
        }
        .gym-stat .sub {
            font-size: 11px; color: var(--sub); margin-top: 4px;
        }
        .gym-stat .status-dot {
            display: inline-block; width: 8px; height: 8px;
            border-radius: 50%; margin-right: 4px;
            animation: pulse-dot 2s infinite;
        }
        .gym-stat .status-dot.online { background: var(--green); }
        .gym-stat .status-dot.offline { background: var(--red); animation: none; }
        .chart-wrap {
            width: 100%; margin-top: 8px; position: relative;
        }
        .today-live-dot {
            position: absolute; display: none; width: 8px; height: 8px;
            border-radius: 50%; background: #2563eb;
            box-shadow: 0 0 0 3px rgba(37,99,235,.16);
            transform: translate(-50%, -50%);
            pointer-events: none;
            animation: live-dot-pulse 1.6s ease-in-out infinite;
            z-index: 4;
        }
        @keyframes live-dot-pulse {
            0%, 100% { opacity: .55; box-shadow: 0 0 0 2px rgba(37,99,235,.12); }
            50% { opacity: 1; box-shadow: 0 0 0 5px rgba(37,99,235,.28); }
        }
        .chart-wrap canvas {
            width: 100%; height: 140px; display: block;
            border-radius: 8px; background: #fafbfc;
        }
        .chart-tip {
            position: absolute; pointer-events: none;
            background: rgba(30,30,40,.9); color: #fff;
            font-size: 11px; font-weight: 600;
            padding: 4px 9px; border-radius: 6px;
            white-space: nowrap; display: none;
            z-index: 5; top: 0;
        }
        .chart-legend {
            display: flex; justify-content: center; gap: 16px;
            font-size: 10px; color: var(--sub); margin-top: 6px;
        }
        .chart-legend span {
            display: flex; align-items: center; gap: 4px;
        }
        .chart-legend .swatch {
            display: inline-block; width: 12px; height: 3px; border-radius: 2px;
        }
        .chart-legend .swatch.today { background: linear-gradient(90deg, #2563eb, #7c3aed); }
        .chart-legend .swatch.yesterday { background: repeating-linear-gradient(90deg, #555 0 3px, transparent 3px 7px); height: 3px; }
        .btn-icon {
            display: inline-flex; align-items: center; justify-content: center;
            width: 24px; height: 24px; border: 1px solid var(--border);
            border-radius: 6px; background: #fff; cursor: pointer;
            font-size: 14px; color: var(--sub); transition: all .15s;
            vertical-align: middle; margin-left: 6px;
        }
        .btn-icon:hover { background: #f0f1f5; color: var(--text); }
        .btn-icon:active { transform: scale(.92); }

        /* ====== 加载/空状态 ====== */
        .loading-box {
            text-align: center; padding: 28px;
        }
        .spinner {
            width: 28px; height: 28px; margin: 0 auto 10px;
            border: 2.5px solid #e8eaed; border-top-color: var(--blue);
            border-radius: 50%; animation: spin .7s linear infinite;
        }
        @keyframes spin { to{transform:rotate(360deg)} }

        /* ====== 底部 ====== */
        .footer {
            text-align: center; margin-top: 20px;
            font-size: 11px; color: #ccc;
        }

        /* ====== 电脑端微调 ====== */
        @media (min-width: 640px) {
            .plate-tag { font-size: 16px; padding: 5px 14px; }
            .info-grid { gap: 8px; }
            .info-item { padding: 8px 10px; }
            .info-item .value { font-size: 13px; }
            .info-item .value.fee { font-size: 16px; }
        }
    </style>
</head>
<body>
    <div class="container">

        <div class="header">
            <div class="avatar">📋</div>
            <h1>便捷面板</h1>
            <p>常用工具 & 数据看板</p>
        </div>

        <div class="grid">

            <!-- ══════ 停车看板 ══════ -->
            <div class="card" id="parkCard">
                <div class="card-header">
                    <div class="card-icon blue">🅿️</div>
                    <div>
                        <div class="card-title">停车看板</div>
                        <div class="card-sub" id="parkName">加载中...</div>
                    </div>
                </div>
                <div class="card-body" id="parkBody">
                    <div class="loading-box"><div class="spinner"></div><p style="font-size:12px;color:var(--sub);">查询中...</p></div>
                </div>
            </div>

            <!-- ══════ 占位 ══════ -->
            <div class="card" id="serverCard">
                <div class="card-header">
                    <div class="card-icon blue">🖥️</div>
                    <div><div class="card-title">服务器状态</div><div class="card-sub" id="serverUpdated">加载中...</div></div>
                </div>
                <div class="card-body" id="serverBody">
                    <div class="loading-box"><div class="spinner"></div><p style="font-size:12px;color:var(--sub);">读取状态中...</p></div>
                </div>
            </div>
            <!-- ══════ 健身房人数监控 ══════ -->
            <div class="card" id="gymCard">
                <div class="card-header">
                    <div class="card-icon purple">🏋️</div>
                    <div>
                        <div class="card-title">健身房人数监控</div>
                        <div class="card-sub" id="gymName">722店-长治Look·长城旗舰店</div>
                    </div>
                </div>
                <div class="card-body" id="gymBody">
                    <div class="gym-stat">
                        <div class="big-num" id="gymOnlineCount">--</div>
                        <div class="label">
                            <span class="status-dot" id="gymStatusDot"></span>
                            当前在线人数
                            <button class="btn-icon" id="gymRefreshBtn" onclick="gymManualRefresh()" title="手动刷新">↻</button>
                        </div>
                    </div>
                    <div class="chart-wrap">
                        <canvas id="gymChart"></canvas>
                        <div class="today-live-dot" id="gymLiveDot"></div>
                        <div class="chart-tip" id="gymChartTip"></div>
                    </div>
                    <div class="chart-legend">
                        <span><span class="swatch today"></span>今日实时</span>
                        <span><span class="swatch yesterday"></span>昨日参考</span>
                    </div>
                </div>
            </div>
            <div class="placeholder-card">
                <div class="icon">🧮</div><div class="title">计算器工具</div><div class="hint">即将上线</div>
            </div>
            <div class="placeholder-card">
                <div class="icon">🔧</div><div class="title">其他工具</div><div class="hint">即将上线</div>
            </div>

        </div>

        <div class="footer">海南大学 · 便捷面板</div>
    </div>

    <script>
        const WARN_H = 40;
        const DANGER_H = 46; // 距48h不足6h → 红色
        const LIMIT_H = 48;

        let parkData = null;
        let tickTimer = null;
        let serverTimer = null;

        window.addEventListener('DOMContentLoaded', () => {
            fetchParkData(); fetchServerStatus(); serverTimer = setInterval(fetchServerStatus, 60000);
        });
        window.addEventListener('beforeunload', () => { clearInterval(tickTimer); clearInterval(serverTimer); clearInterval(gymTimer); });

        async function fetchServerStatus() {
            try {
                const response = await fetch('/api/server-status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || '读取失败');
                renderServerStatus(data);
            } catch (err) { renderServerError('状态服务不可用'); }
        }

        function renderServerStatus(data) {
            const connectivity = (data.connectivity || 'UNKNOWN').toUpperCase();
            const level = connectivity === 'ONLINE' ? 'online' : connectivity === 'OFFLINE' ? 'offline' : connectivity === 'STALE' ? 'stale' : 'unknown';
            document.getElementById('serverUpdated').textContent = data.checked_at ? '检测于 ' + fmtTs(data.checked_at) : '暂无检测时间';
            const ports = Object.entries({ ...(data.ports || {}), icmp: Boolean(data.ping) }).map(([name, open]) =>
                '<span class="port-chip ' + (open ? 'open' : '') + '">' + esc(name.toUpperCase()) + ' ' + (open ? 'OPEN' : 'CLOSED') + '</span>'
            ).join('');
            document.getElementById('serverBody').innerHTML =
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><span class="status-pill ' + level + '"><span>●</span>' + esc(connectivity) + '</span><span style="font-size:12px;color:var(--sub);">服务器地址：<b style="color:var(--text);">' + esc(data.host || 'UNKNOWN') + '</b></span></div>' +
                '<div class="info-grid"><div class="info-item"><div class="label">系统信息</div><div class="value">' + esc(data.status || 'UNKNOWN') + '</div></div><div class="info-item"><div class="label">最近状态变更</div><div class="value" style="font-size:12px;">' + fmtStateChange(data.last_state_change_at) + '</div></div></div>' +
                '<div class="limit-msg ' + level + '" style="text-align:left;">' + esc(data.reason || '暂无判定理由') + (data.consecutive_offline_count > 0 ? '（离线采样 ' + data.consecutive_offline_count + ' 次）' : '') + '</div><div class="port-list">' + (ports || '<span class="port-chip">暂无端口数据</span>') + '</div><button class="btn btn-outline" style="margin-top:12px;" onclick="fetchServerStatus()">↻ 刷新服务器状态</button>';
        }

        function renderServerError(message) {
            document.getElementById('serverUpdated').textContent = '读取失败';
            document.getElementById('serverBody').innerHTML = '<div style="min-height:150px;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div class="limit-msg danger" style="text-align:center;">⚠️ ' + esc(message) + '</div><button class="btn btn-outline" style="width:auto;margin-top:12px;" onclick="fetchServerStatus()">↻ 重试</button></div>';
        }

        function fmtStateChange(value) { return value ? fmtTs(value) : '1970/1/1 0:00'; }

        async function fetchParkData() {
            const plate = loadPlate();
            try {
                const resp = await fetch('/api/detail?plate=' + encodeURIComponent(plate), {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(12000),
                });
                const data = await resp.json();
                if (data.success) { parkData = data; renderParkData(data); startTick(); }
                else { renderEmpty('车辆不在停车场内'); }
            } catch (err) { renderEmpty('网络异常'); }
        }

        function loadPlate() {
            try {
                return JSON.parse(localStorage.getItem('hainanu_board_plate') || '{}').plate || '琼A054DB';
            } catch (e) { return '琼A054DB'; }
        }

        function renderParkData(d) {
            const card = document.getElementById('parkCard');
            card.style.display = ''; card.style.flexDirection = '';
            const el = document.getElementById('parkBody');
            el.style.display = ''; el.style.flexDirection = ''; el.style.flex = '';
            document.getElementById('parkName').textContent = d.parkName || '海南大学海甸校区';

            const plate = d.plate || '--';
            const paid = d.bill?.paid === true;

            if (paid) {
                // ---- 已缴费未驶出状态 ----
                const freeMin = d.bill?.freeMin || 0;
                const freeH = Math.floor(freeMin / 60), freeM = freeMin % 60;
                const freeStr = freeH > 0 ? freeH + 'h' + freeM + 'm' : freeM + 'm';
                const nextCharge = d.bill?.nextChargeMin > 0
                    ? '<span style="font-size:11px;color:var(--sub);">' + nextChargeText(d.bill.nextChargeMin, d.bill.nextChargeFee) + '</span>' : '';

                el.innerHTML = '<div class="plate-row"><div class="plate-tag">' + esc(fmtPlate(plate)) + '</div>' +
                    '<div class="park-status parked"><span class="dot"></span>已缴费未驶出</div></div>' +
                    '<div class="info-grid"><div class="info-item"><div class="label">剩余免费停车时间</div>' +
                    '<div class="value" style="font-size:12px;" id="durVal">' + esc(freeStr) + '</div></div>' +
                    '<div class="info-item"><div class="label">停车时长</div>' +
                    '<div class="value">' + fmtDur(parseInt(d.bill.durationMinutes)) + '</div></div>' +
                    '<div class="info-item" style="grid-column:1/-1;"><div class="label">应缴金额</div>' +
                    '<div style="display:flex;justify-content:space-between;align-items:baseline;">' +
                    '<span class="value fee" style="color:var(--green);">¥0.00</span>' + nextCharge + '</div></div></div>' +
                    '<div class="limit-msg safe" style="text-align:center;">✅ 已缴费，请尽快驶出停车场!</div>' +
                    '<div style="display:flex;gap:8px;margin-top:12px;">' +
                    '<button class="btn btn-pay" style="background:#a0c8a8;cursor:not-allowed;box-shadow:none;" disabled>已缴费</button>' +
                    '<button class="btn btn-outline" style="width:auto;flex-shrink:0;padding:12px 14px;" onclick="fetchParkData()" title="刷新">🔄</button></div>';
                return;
            }

            // ---- 未缴费状态 ----
            const entryStr = d.bill?.entryTimeStr || fmtTs(d.entryTime) || '--';
            const fee = d.bill?.totalFee != null ? Number(d.bill.totalFee).toFixed(2) : null;
            const parkMin = d.bill?.durationMinutes != null ? parseInt(d.bill.durationMinutes) : null;
            const hours = parkMin !== null ? Math.floor(parkMin / 60) : null;
            const level = hours !== null ? getLevel(hours) : 'safe';

            el.innerHTML =
                \`<div class="plate-row">
                    <div class="plate-tag">\${esc(fmtPlate(plate))}</div>
                    <div class="park-status parked"><span class="dot"></span>停车中</div>
                </div>

                <div class="info-grid">
                    <div class="info-item">
                        <div class="label">入场时间</div>
                        <div class="value" style="font-size:12px;">\${esc(entryStr)}</div>
                    </div>
                    <div class="info-item">
                        <div class="label">停车时长</div>
                        <div class="value" id="durVal">\${fmtDur(parkMin)}</div>
                    </div>
                    <div class="info-item" style="grid-column:1/-1;">
                        <div class="label">应缴金额</div>
                        <div style="display:flex;justify-content:space-between;align-items:baseline;">
                            <span class="value fee">\${fee != null ? '¥' + fee : '--'}</span>
                            \${d.bill?.nextChargeMin > 0 ? '<span style="font-size:11px;color:var(--sub);">' + nextChargeText(d.bill.nextChargeMin, d.bill.nextChargeFee) + '</span>' : ''}
                        </div>
                    </div>
                </div>

                \${hours !== null ? \`
                <div class="limit-bar">
                    <div class="labels"><span>0h</span><span>48h</span></div>
                    <div class="track"><div class="fill \${level}" id="limitFill" style="width:\${Math.min(100,hours/LIMIT_H*100)}%"></div></div>
                </div>
                <div class="limit-msg \${level}" id="limitMsg">\${limitMsg(hours)}</div>
                \` : ''}

                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-pay" onclick="goPay()">快捷缴费</button>
                    <button class="btn btn-outline" style="width:auto;flex-shrink:0;padding:12px 14px;" onclick="fetchParkData()" title="刷新">🔄</button>
                </div>\`;
        }

        function renderEmpty(msg) {
            document.getElementById('parkName').textContent = parkData?.parkName || '暂无记录';
            const plate = parkData?.plate || loadPlate();
            const card = document.getElementById('parkCard');
            card.style.display = 'flex'; card.style.flexDirection = 'column';
            const el = document.getElementById('parkBody');
            el.style.display = 'flex'; el.style.flexDirection = 'column'; el.style.flex = '1';
            el.innerHTML =
                '<div class="plate-row"><div class="plate-tag">' + esc(fmtPlate(plate)) + '</div>' +
                '<div class="park-status" style="color:var(--red);"><span class="dot" style="background:var(--red);animation:none;"></span>未入场</div></div>' +
                '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--sub);">' +
                '<div style="text-align:center;"><div style="font-size:36px;margin-bottom:6px;">🚗</div>' +
                '<p style="font-size:13px;">' + esc(msg) + '</p>' +
                '<button class="btn btn-outline" style="margin-top:12px;" onclick="fetchParkData()">🔄 重新查询</button></div></div>';
            clearInterval(tickTimer);
        }

        function startTick() {
            clearInterval(tickTimer);
            tickTimer = setInterval(() => {
                // 已缴费状态：倒计时免费剩余时间 + 下次加钱
                if (parkData?.bill?.paid) {
                    if (parkData.bill.freeMin > 0) parkData.bill.freeMin = Math.max(0, parkData.bill.freeMin - 10/60);
                    if (parkData.bill.nextChargeMin > 0) parkData.bill.nextChargeMin = Math.max(0, parkData.bill.nextChargeMin - 10/60);
                    return; // 已缴费状态数据每30s刷新一次即可
                }
                // 未缴费状态
                if (parkData?.bill?.durationMinutes == null) return;
                parkData.bill.durationMinutes = parseInt(parkData.bill.durationMinutes) + 10/60;
                const min = Math.floor(parkData.bill.durationMinutes);
                const durEl = document.getElementById('durVal');
                if (durEl) durEl.textContent = fmtDur(min);

                const h = Math.floor(min / 60);
                const level = getLevel(h);
                const fill = document.getElementById('limitFill');
                if (fill) { fill.style.width = Math.min(100, h/LIMIT_H*100) + '%'; fill.className = 'fill ' + level; }
                const msg = document.getElementById('limitMsg');
                if (msg) { msg.textContent = limitMsg(h); msg.className = 'limit-msg ' + level; }

                // 刷新倒计时
                if (parkData.bill.nextChargeMin > 0) {
                    parkData.bill.nextChargeMin = Math.max(0, parkData.bill.nextChargeMin - 10/60);
                }
            }, 10000);
        }

        function goPay() {
            if (parkData?.payUrl) window.location.href = parkData.payUrl;
            else fetchParkData().then(() => { if (parkData?.payUrl) window.location.href = parkData.payUrl; });
        }

        // ═══════════════════════════════════════════
        //  健身房人数监控
        // ═══════════════════════════════════════════

        const GYM_POLL_INTERVAL = 300000;  // 每5分钟自动轮询一次
        const GYM_STORAGE_KEY = 'gym_today_data';
        let gymTimer = null;

        /** 获取今日的数据存储 key（YYYY-MM-DD） */
        function gymTodayKey() {
            return new Date().toISOString().slice(0, 10);
        }

        /** 从 localStorage 加载今日已采集的数据 */
        function gymLoadToday() {
            try {
                const raw = localStorage.getItem(GYM_STORAGE_KEY);
                if (!raw) return {};
                const all = JSON.parse(raw);
                return all[gymTodayKey()] || {};
            } catch { return {}; }
        }

        /** 保存一条新采集的数据到 localStorage */
        function gymSaveSample(count) {
            const now = new Date();
            const h = now.getHours();
            const key = gymTodayKey();
            let all = {};
            try { all = JSON.parse(localStorage.getItem(GYM_STORAGE_KEY) || '{}'); } catch {}
            if (!all[key]) all[key] = {};
            if (!all[key][h]) all[key][h] = [];
            all[key][h].push({ count, m: now.getMinutes(), t: Date.now() });
            // 只保留最近7天，控制大小
            const days = Object.keys(all).sort();
            while (days.length > 7) {
                delete all[days.shift()];
            }
            localStorage.setItem(GYM_STORAGE_KEY, JSON.stringify(all));
        }

        /** 将服务器当天记录转换为图表使用的小时采样对象 */
        function gymBuildTodayData(records) {
            const result = {};
            (records || []).forEach(r => {
                const h = parseInt(r.time.slice(0, 2), 10);
                const m = parseInt(r.time.slice(2, 4), 10);
                const sampleTime = new Date();
                sampleTime.setHours(h, m, 0, 0);
                if (!result[h]) result[h] = [];
                result[h].push({ count: r.count, m, t: sampleTime.getTime() });
            });
            return result;
        }

        /** 获取本周签到数据（参考线） */
        async function gymFetchWeeklyRef() {
            try {
                const resp = await fetch('/api/gym/weekly-stats', {
                    cache: 'no-store', signal: AbortSignal.timeout(8000),
                });
                const data = await resp.json();
                if (data.success && Array.isArray(data.slots)) {
                    // 转换为小时映射: "0:00~8:00" → 小时0-7都赋值
                    const ref = {};
                    data.slots.forEach(s => {
                        const match = s.timeQuantum.match(/(d+):00~(d+):00/);
                        if (match) {
                            const startH = parseInt(match[1]);
                            const endH = parseInt(match[2]);
                            for (let h = startH; h < endH; h++) ref[h] = s.count;
                        }
                    });
                    // 计算全天平均
                    const counts = data.slots.map(s => s.count).filter(c => c != null);
                    const avg = counts.length ? Math.round(counts.reduce((a,b) => a+b, 0) / counts.length) : 0;
                    return { ref, avg };
                }
            } catch {}
            return { ref: {}, avg: 0 };
        }

        /** 将昨日数据转为以小时为key的映射（取每小时的均值） */
        function gymBuildYesterdayHourly(yesterdayData) {
            const buckets = {};
            yesterdayData.forEach(r => {
                const h = parseInt(r.time.slice(0, 2), 10);
                if (!buckets[h]) buckets[h] = [];
                buckets[h].push(r.count);
            });
            const result = {};
            for (let h = 0; h < 24; h++) {
                if (buckets[h] && buckets[h].length) {
                    const sum = buckets[h].reduce((a, b) => a + b, 0);
                    result[h] = Math.round(sum / buckets[h].length);
                }
            }
            return result;
        }

        /** 绘制健身房图表 */
        function gymDrawChart(todayData, yesterdayData, refData, weeklyAvg) {
            const canvas = document.getElementById('gymChart');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            const W = rect.width;
            const H = 140;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.scale(dpr, dpr);

            const now = new Date();
            const currentHour = now.getHours();
            const currentMin = now.getMinutes();

            // 整理今日数据：首次采样前用周均填充，之后用真实数据，未来不显示
            let firstRealH = 24;
            for (let h = 0; h < 24; h++) {
                if (todayData[h] && todayData[h].length > 0) { firstRealH = h; break; }
            }
            const hourlyData = [];
            for (let h = 0; h < 24; h++) {
                let val = null;
                const samples = todayData[h];
                if (samples && samples.length > 0) {
                    if (h < currentHour) {
                        const sum = samples.reduce((a, s) => a + s.count, 0);
                        val = Math.round(sum / samples.length);
                    } else {
                        const sorted = [...samples].sort((a, b) => b.t - a.t);
                        val = sorted[0].count;
                    }
                } else if (h < firstRealH && h < currentHour) {
                    // 首次采样前用本周均值填充
                    val = refData[h] != null ? refData[h] : null;
                }
                // 首次采样后无真实数据 or h > currentHour → null（曲线不延伸）
                hourlyData.push(val);
            }

            // 整理昨日数据（已含0-8点）
            const yesterdayHourly = gymBuildYesterdayHourly(yesterdayData);

            // Y轴固定0-100，每10人一格
            const MAX_Y = 100, Y_STEP = 10, ySteps = MAX_Y / Y_STEP;

            const pad = { top: 12, bottom: 18, left: 32, right: 12 };
            const chartW = W - pad.left - pad.right;
            const chartH = H - pad.top - pad.bottom;
            const colW = chartW / 24;

            ctx.clearRect(0, 0, W, H);

            // ---- Y轴网格线 + 标签 ----
            ctx.strokeStyle = '#ebeef2';
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= ySteps; i++) {
                const y = pad.top + chartH - (chartH / ySteps) * i;
                ctx.beginPath();
                ctx.moveTo(pad.left, y);
                ctx.lineTo(W - pad.right, y);
                ctx.stroke();
                // Y轴标签
                ctx.fillStyle = '#b0b2b8';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(Y_STEP * i, pad.left - 4, y + 3);
            }

            // ---- X轴标签（00:00 到 24:00） ----
            ctx.fillStyle = '#b0b2b8';
            ctx.font = '9px sans-serif';
            for (let h = 0; h <= 24; h += 2) {
                const x = pad.left + chartW * h / 24;
                ctx.textAlign = h === 0 ? 'left' : (h === 24 ? 'right' : 'center');
                const labelHour = h === 24 ? 0 : h;
                ctx.fillText(String(labelHour) + ':00', x, H - 3);
            }

            // ---- 绘制昨日数据线（深灰色点线） ----
            ctx.strokeStyle = '#555';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            let prevY = null;
            for (let h = 0; h < 24; h++) {
                const val = yesterdayHourly[h];
                const x = pad.left + colW * h + colW / 2;
                const y = val != null ? pad.top + chartH - (val / MAX_Y) * chartH : null;
                if (y !== null) {
                    if (prevY === null) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                prevY = y !== null ? y : null;
            }
            ctx.stroke();
            ctx.setLineDash([]);

            // ---- 绘制今日实时折线（蓝色实线） ----
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            prevY = null;
            for (let h = 0; h < 24; h++) {
                const val = hourlyData[h];
                const x = pad.left + colW * h + colW / 2;
                const y = val !== null ? pad.top + chartH - (val / MAX_Y) * chartH : null;
                if (y !== null) {
                    if (prevY === null) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                prevY = y !== null ? y : null;
            }
            ctx.stroke();

            // 使用蓝线最后一个实际绘制点的同一组坐标，保证圆心与曲线末端重合。
            const liveDot = document.getElementById('gymLiveDot');
            let lastTodayHour = -1;
            for (let h = hourlyData.length - 1; h >= 0; h--) {
                if (hourlyData[h] !== null) {
                    lastTodayHour = h;
                    break;
                }
            }
            if (liveDot && lastTodayHour >= 0) {
                const dotX = pad.left + colW * lastTodayHour + colW / 2;
                const dotY = pad.top + chartH - (hourlyData[lastTodayHour] / MAX_Y) * chartH;
                liveDot.style.left = dotX + 'px';
                liveDot.style.top = dotY + 'px';
                liveDot.style.display = 'block';
            } else if (liveDot) {
                liveDot.style.display = 'none';
            }

            // ---- 填充区域（渐变，到当前小时） ----
            const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
            grad.addColorStop(0, 'rgba(37,99,235,0.15)');
            grad.addColorStop(1, 'rgba(37,99,235,0.01)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            let started = false;
            for (let h = 0; h < 24; h++) {
                const val = hourlyData[h];
                const x = pad.left + colW * h + colW / 2;
                const y = val !== null ? pad.top + chartH - (val / MAX_Y) * chartH : null;
                if (y !== null) {
                    if (!started) {
                        ctx.moveTo(x, pad.top + chartH);
                        ctx.lineTo(x, y);
                        started = true;
                    } else {
                        ctx.lineTo(x, y);
                    }
                } else if (started) {
                    const prevX = pad.left + colW * (h - 1) + colW / 2;
                    ctx.lineTo(prevX, pad.top + chartH);
                    ctx.closePath();
                    ctx.fill();
                    started = false;
                    ctx.beginPath();
                }
            }
            if (started) {
                const lastH = hourlyData.reduceRight((found, v, i) => v !== null ? i : found, -1);
                if (lastH >= 0) {
                    const x = pad.left + colW * lastH + colW / 2;
                    ctx.lineTo(x, pad.top + chartH);
                    ctx.closePath();
                    ctx.fill();
                }
            }

            // ---- 构建分钟级采样点供 hover 使用 ----
            // 今日：每个采样点精确到分钟
            const todayPoints = [];
            Object.keys(todayData).forEach(hStr => {
                const h = parseInt(hStr);
                (todayData[h] || []).forEach(s => {
                    todayPoints.push({ min: h * 60 + (s.m || 0), count: s.count });
                });
            });
            todayPoints.sort((a, b) => a.min - b.min);
            // 昨日同理
            const yesterdayPoints = (yesterdayData || []).map(r => ({
                min: parseInt(r.time.slice(0,2)) * 60 + parseInt(r.time.slice(2,4)),
                count: r.count
            })).sort((a, b) => a.min - b.min);

            // 保存数据供 hover 交互
            canvas._chartData = { todayPoints, yesterdayPoints, pad, colW };
            if (!canvas._hoverInitialized) {
                canvas._hoverInitialized = true;
                const tip = document.getElementById('gymChartTip');
                canvas.addEventListener('mousemove', function(e) {
                    const d = this._chartData;
                    if (!d) return;
                    const rect = this.getBoundingClientRect();
                    const mx = e.clientX - rect.left;
                    const hoverMin = ((mx - d.pad.left) / d.colW) * 60;
                    if (hoverMin < 0 || hoverMin > 1440) { tip.style.display = 'none'; return; }

                    // 最近今日采样点（限30分钟内）
                    let bestT = null, bestTD = 31;
                    d.todayPoints.forEach(p => { const dist = Math.abs(p.min - hoverMin); if (dist < bestTD) { bestTD = dist; bestT = p; } });
                    // 最近昨日采样点（限30分钟内）
                    let bestY = null, bestYD = 31;
                    d.yesterdayPoints.forEach(p => { const dist = Math.abs(p.min - hoverMin); if (dist < bestYD) { bestYD = dist; bestY = p; } });

                    if (!bestT && !bestY) { tip.style.display = 'none'; return; }

                    const parts = [];
                    if (bestT) {
                        const hh = String(Math.floor(bestT.min / 60)).padStart(2,'0');
                        const mm = String(bestT.min % 60).padStart(2,'0');
                        parts.push('今日 ' + hh + ':' + mm + '  ' + bestT.count + '人');
                    }
                    if (bestY) {
                        const hh = String(Math.floor(bestY.min / 60)).padStart(2,'0');
                        const mm = String(bestY.min % 60).padStart(2,'0');
                        parts.push('昨日 ' + hh + ':' + mm + '  ' + bestY.count + '人');
                    }
                    tip.textContent = parts.join('  │  ');
                    let tx = e.clientX - rect.left - tip.offsetWidth / 2;
                    tx = Math.max(2, Math.min(tx, rect.width - tip.offsetWidth - 2));
                    tip.style.left = tx + 'px';
                    tip.style.top = Math.max(2, e.clientY - rect.top - tip.offsetHeight - 8) + 'px';
                    tip.style.display = 'block';
                });
                canvas.addEventListener('mouseleave', function() { tip.style.display = 'none'; });
            }
        }

        let gymYesterdayData = [];  // 缓存昨日数据

        /** 获取服务器当天已采集的完整数据 */
        async function gymFetchToday() {
            try {
                const resp = await fetch('/api/gym/today-data', {
                    cache: 'no-store', signal: AbortSignal.timeout(8000),
                });
                const data = await resp.json();
                if (data.success && Array.isArray(data.records)) {
                    return gymBuildTodayData(data.records);
                }
            } catch {}
            return null;
        }

        /** 轮询：获取当前在线人数 */
        async function gymPoll() {
            try {
                const resp = await fetch('/api/gym/current-online', {
                    cache: 'no-store', signal: AbortSignal.timeout(8000),
                });
                const data = await resp.json();
                if (data.success && data.count !== null && data.count !== undefined) {
                    const count = data.count;

                    // 更新大数字
                    const el = document.getElementById('gymOnlineCount');
                    el.textContent = count;
                    el.classList.remove('loading');

                    // 状态点
                    document.getElementById('gymStatusDot').className = 'status-dot online';

                    // 服务器端持续采集的数据是今日曲线的唯一来源；
                    // localStorage 仅作为服务器接口暂时不可用时的降级数据。
                    const serverTodayData = await gymFetchToday();
                    const todayData = serverTodayData || gymLoadToday();

                    // 重绘图表（含昨日参考线）
                    const [weeklyData] = await Promise.all([gymFetchWeeklyRef()]);
                    gymDrawChart(todayData, gymYesterdayData, weeklyData.ref, weeklyData.avg);
                } else {
                    throw new Error(data.error || '数据为空');
                }
            } catch (err) {
                // 异常时显示状态
                const el = document.getElementById('gymOnlineCount');
                if (el.textContent === '--') {
                    el.classList.add('loading');
                }
                document.getElementById('gymStatusDot').className = 'status-dot offline';
            }
        }

        /** 手动刷新（点按钮触发，然后重置5分钟计时器） */
        async function gymManualRefresh() {
            const btn = document.getElementById('gymRefreshBtn');
            btn.style.transform = 'rotate(360deg)';
            btn.style.transition = 'transform .4s';
            setTimeout(() => btn.style.transition = '', 500);
            await gymPoll();
            // 重置计时器：从当前时刻再过5分钟
            if (gymTimer) clearInterval(gymTimer);
            gymTimer = setInterval(gymPoll, GYM_POLL_INTERVAL);
        }

        /** 获取昨日数据 */
        async function gymFetchYesterday() {
            try {
                const resp = await fetch('/api/gym/yesterday-data', {
                    cache: 'no-store', signal: AbortSignal.timeout(8000),
                });
                const data = await resp.json();
                if (data.success && Array.isArray(data.records)) {
                    gymYesterdayData = data.records;
                }
            } catch {}
        }

        /** 初始化健身房监控 */
        function gymInit() {
            // 先加载昨日数据，再首次轮询
            gymFetchYesterday().then(() => gymPoll());
            // 启动定时轮询
            if (gymTimer) clearInterval(gymTimer);
            gymTimer = setInterval(gymPoll, GYM_POLL_INTERVAL);
        }

        // 启动健身房监控（在DOM加载后）
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(gymInit, 500);  // 让主页面先渲染
        });

        function getLevel(h) {
            if (h >= DANGER_H) return 'danger';  // ≥46h → 红色
            if (h >= WARN_H) return 'alert';      // ≥40h → 黄色
            return 'safe';
        }
        function limitMsg(h) {
            const left = LIMIT_H - h;
            if (h >= DANGER_H) return \`⚠️ 仅剩 \${left} 小时达拉黑线，请尽快缴费离场\`;
            if (h >= WARN_H)  return \`⏰ 已停 \${h} 小时，距拉黑线还有 \${left} 小时\`;
            return \`✅ 停车时长正常，距拉黑线还有 \${left} 小时\`;
        }
        function fmtDur(min) {
            if (min == null) return '--';
            const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
            if (d > 0) return d + '天' + h + '小时' + m + '分';
            if (h > 0) return h + '小时' + m + '分';
            return m + '分钟';
        }
        function fmtTs(ts) {
            if (!ts) return null;
            const d = new Date(ts);
            return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+
                   String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
        }
        function nextChargeText(min, fee) {
            const h = Math.floor(min / 60), m = min % 60;
            let s = h > 0 ? h + 'h' : '';
            if (m > 0 || h === 0) s += m + 'm';
            s += ' 后加¥' + (fee != null ? fee : '?');
            return s;
        }
        function fmtPlate(p) {
            // 琼A054DB → 琼A·054DB
            if (!p || p.length < 3) return p;
            return p.slice(0, 2) + '·' + p.slice(2);
        }
        function esc(s) {
            const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML;
        }
    </script>
</body>
</html>
`;
