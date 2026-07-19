/**
 * 海大停车场一键缴费 - Cloudflare Worker
 * ============================================
 * 部署: npx wrangler deploy
 */

// ==================== 配置 ====================
const CONFIG = {
    BASE_URL: 'https://hkioc.hainanu.edu.cn',
    SEARCH_PAGE: '/pms/carParkMobile/carpayment/search',
    SEARCH_API: '/pms/action/mobile/getInRecordByPlateNo',
    BILL_API: '/pms/action/mobile/bill',
    PAY_PATH: '/pms/carParkMobile/carpayment/carpaying/',
    TIMEOUT: 12000,
};

// ==================== HTTP客户端（替代axios） ====================
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
    // 从Set-Cookie头提取cookie字符串
    const setCookie = resp.headers.get('set-cookie') || '';
    return setCookie.split(',').map(c => c.trim().split(';')[0]).filter(Boolean).join('; ');
}

// ==================== API查询 ====================
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
    // 22:00费用取决于是否跨24h周期边界：同一周期内¥2，跨周期后¥5
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

// ==================== JSON响应 ====================
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
}

// ==================== 服务器状态 KV ====================
// Andy 通过 HMAC 签名向本 Worker 上报，KV 只保存最新一份状态。
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
    if (!env.SERVER_STATUS) return json({ error: '未绑定 SERVER_STATUS KV Namespace' }, 503);
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
    if (!env.SERVER_STATUS) return json({ error: '未绑定 SERVER_STATUS KV Namespace' }, 503);
    const text = await env.SERVER_STATUS.get('latest');
    if (!text) return json({ error: '尚未收到 Andy 的服务器状态上报' }, 404);
    try {
        const report = JSON.parse(text);
        const checkedMs = Date.parse(report.reported_at);
        return json({
            source: 'worker-kv',
            host: report.host || null,
            connectivity: !Number.isFinite(checkedMs) || Date.now() - checkedMs > 3 * 60 * 1000
                ? 'STALE' : (report.connectivity || 'UNKNOWN'),
            last_confirmed_os: report.last_confirmed_os || 'UNKNOWN',
            status: report.status || 'UNKNOWN',
            checked_at: report.reported_at || null,
            last_state_change_at: report.last_state_change_at || null,
            consecutive_offline_count: report.consecutive_offline_count || 0,
            reason: report.reason || '暂无判定理由',
            ports: report.ports || {},
            ping: Boolean(report.ping),
        });
    } catch (e) {
        return json({ error: 'KV 中的服务器状态数据无效' }, 500);
    }
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: 健康检查
    if (path === '/api/health') {
        return json({ status: 'ok', time: new Date().toISOString() });
    }

    if (path === '/api/server-report' && request.method === 'POST') return receiveServerReport(request, env);
    if (path === '/api/server-status' && request.method === 'GET') return getServerStatus(env);

    // API: 车牌详情
    if (path === '/api/detail') {
        const plate = url.searchParams.get('plate')?.trim();
        if (!plate) return json({ success: false, error: '请提供车牌号' }, 400);

        try {
            const result = await queryPlate(plate);
            if (!result) return json({ success: false, error: '未找到停车记录' }, 404);

            const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);
            let bill = null;
            try {
                bill = await queryBill(result.plate, result.parkId, result.enIndexCode, result.vehicleType, result.entryTime);
            } catch (e) { /* 费用查询失败不阻断 */ }

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
            return json({ success: false, error: '请求失败: ' + e.message }, 502);
        }
    }

    // API: 搜索+缴费跳转
    if (path === '/api/search') {
        const plate = url.searchParams.get('plate')?.trim();
        const redirect = url.searchParams.get('redirect') === '1';
        if (!plate) return json({ success: false, error: '请提供车牌号' }, 400);

        try {
            const result = await queryPlate(plate);
            if (!result) return json({ success: false, error: '未找到停车记录' }, 404);

            const payUrl = buildPayUrl(result.plate, result.parkId, result.enIndexCode);
            if (redirect) return Response.redirect(payUrl, 302);
            return json({ success: true, plate, parkId: result.parkId, enIndexCode: result.enIndexCode, payUrl });
        } catch (e) {
            return json({ success: false, error: '请求失败: ' + e.message }, 502);
        }
    }

    // 静态页面: 看板
    if (path === '/' || path === '/board') {
        return new Response(DASHBOARD_HTML, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }

    // 404
    return json({ error: 'Not Found' }, 404);
}

// ==================== 启动 ====================
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    },
};

// ==================== 内嵌HTML（Cloudflare Workers不支持fs读取文件） ====================
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>便捷面板</title>
    <style>
        :root {
            --bg: #f2f3f7; --card: #ffffff; --text: #1d1d2b; --sub: #8e8ea0;
            --border: #ebeef2; --radius: 16px;
            --shadow: 0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.06);
            --blue: #2563eb; --blue-bg: #eff4ff; --green: #16a34a; --green-bg: #f0faf3;
            --amber: #d97706; --amber-bg: #fffbeb; --red: #dc2626; --red-bg: #fef2f2;
        }
        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
            background: var(--bg); color: var(--text); min-height: 100vh;
            padding: 20px 16px 40px; -webkit-tap-highlight-color: transparent; -webkit-font-smoothing: antialiased;
        }
        .container { max-width: 960px; margin: 0 auto; }
        .header { text-align: center; padding: 16px 0 24px; }
        .header .avatar {
            width: 48px; height: 48px; background: linear-gradient(135deg, #2563eb, #7c3aed);
            border-radius: 14px; display: inline-flex; align-items: center; justify-content: center;
            font-size: 24px; margin-bottom: 8px; box-shadow: 0 4px 12px rgba(37,99,235,.25);
        }
        .header h1 { font-size: 20px; font-weight: 700; letter-spacing: -.3px; }
        .header p { font-size: 13px; color: var(--sub); margin-top: 2px; }
        .grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
        @media (min-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } }
        .card {
            background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow);
            overflow: hidden; transition: box-shadow .2s;
        }
        .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.08); }
        .card-header { display: flex; align-items: center; gap: 10px; padding: 14px 18px 0; }
        .card-icon {
            width: 36px; height: 36px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0;
        }
        .card-icon.blue { background: var(--blue-bg); }
        .card-title { font-size: 14px; font-weight: 700; }
        .card-sub { font-size: 11px; color: var(--sub); }
        .card-body { padding: 14px 18px 18px; }
        .plate-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .plate-tag {
            display: inline-block; background: #1a1a2e; color: #fff;
            font-size: 18px; font-weight: 800; letter-spacing: 3px;
            padding: 6px 18px; border-radius: 8px;
            font-family: "PingFang SC", "Microsoft YaHei", monospace;
        }
        .park-status { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; }
        .park-status .dot { width: 7px; height: 7px; border-radius: 50%; }
        .park-status.parked .dot { background: var(--green); animation: pulse-dot 2s infinite; }
        .park-status.parked { color: var(--green); }
        @keyframes pulse-dot { 0%,100%{opacity:1} 50%{opacity:.35} }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
        .info-item { background: #f8f9fb; border-radius: 10px; padding: 10px 12px; }
        .info-item .label { font-size: 10px; color: var(--sub); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 2px; }
        .info-item .value { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .info-item .value.fee { font-size: 18px; color: var(--red); }
        .limit-bar { margin-bottom: 14px; }
        .limit-bar .labels { display: flex; justify-content: space-between; font-size: 10px; color: #aaa; margin-bottom: 4px; }
        .limit-bar .track { height: 6px; background: #e8eaed; border-radius: 3px; overflow: hidden; }
        .limit-bar .fill { height: 100%; border-radius: 3px; transition: width 1s linear; }
        .limit-bar .fill.safe { background: var(--green); }
        .limit-bar .fill.alert { background: var(--amber); }
        .limit-bar .fill.danger { background: var(--red); }
        .limit-msg { font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 6px; text-align: center; }
        .limit-msg.safe { background: var(--green-bg); color: var(--green); }
        .limit-msg.alert { background: var(--amber-bg); color: var(--amber); }
        .limit-msg.danger { background: var(--red-bg); color: var(--red); }
        .btn {
            display: flex; align-items: center; justify-content: center;
            gap: 6px; width: 100%; padding: 12px 20px; font-size: 14px; font-weight: 700;
            border: none; border-radius: 12px; cursor: pointer; transition: all .15s; letter-spacing: .5px;
        }
        .btn:active { transform: scale(.97); }
        .btn-pay { background: var(--green); color: #fff; box-shadow: 0 2px 8px rgba(22,163,74,.3); }
        .btn-pay:hover { box-shadow: 0 4px 14px rgba(22,163,74,.4); }
        .btn-outline { background: #fff; color: var(--text); border: 1px solid var(--border); }
        .placeholder-card {
            background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            min-height: 160px; border: 2px dashed #e2e4ea; cursor: default; transition: border-color .2s;
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
        .loading-box { text-align: center; padding: 28px; }
        .spinner {
            width: 28px; height: 28px; margin: 0 auto 10px;
            border: 2.5px solid #e8eaed; border-top-color: var(--blue);
            border-radius: 50%; animation: spin .7s linear infinite;
        }
        @keyframes spin { to{transform:rotate(360deg)} }
        .footer { text-align: center; margin-top: 20px; font-size: 11px; color: #ccc; }
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
            <div class="avatar">&#x1f4cb;</div>
            <h1>便捷面板</h1>
            <p>常用工具 & 数据看板</p>
        </div>
        <div class="grid">
            <div class="card" id="parkCard">
                <div class="card-header">
                    <div class="card-icon blue">&#x1f17f;&#xfe0f;</div>
                    <div>
                        <div class="card-title">停车看板</div>
                        <div class="card-sub" id="parkName">加载中...</div>
                    </div>
                </div>
                <div class="card-body" id="parkBody">
                    <div class="loading-box"><div class="spinner"></div><p style="font-size:12px;color:var(--sub);">查询中...</p></div>
                </div>
            </div>
            <div class="card" id="serverCard"><div class="card-header"><div class="card-icon blue">&#x1f5a5;&#xfe0f;</div><div><div class="card-title">服务器状态</div><div class="card-sub" id="serverUpdated">加载中...</div></div></div><div class="card-body" id="serverBody"><div class="loading-box"><div class="spinner"></div><p style="font-size:12px;color:var(--sub);">读取状态中...</p></div></div></div>
            <div class="placeholder-card"><div class="icon">&#x1fa99;</div><div class="title">Token 消耗看板</div><div class="hint">即将上线</div></div>
            <div class="placeholder-card"><div class="icon">&#x1f9ee;</div><div class="title">计算器工具</div><div class="hint">即将上线</div></div>
            <div class="placeholder-card"><div class="icon">&#x1f527;</div><div class="title">其他工具</div><div class="hint">即将上线</div></div>
        </div>
        <div class="footer">海南大学 · 便捷面板</div>
    </div>
    <script>
        const WARN_H=40,DANGER_H=46,LIMIT_H=48;
        let parkData=null,tickTimer=null,serverTimer=null;
        window.addEventListener('DOMContentLoaded',()=>{fetchParkData();fetchServerStatus();serverTimer=setInterval(fetchServerStatus,60000)});
        window.addEventListener('beforeunload',()=>{clearInterval(tickTimer);clearInterval(serverTimer)});
        async function fetchServerStatus(){try{const r=await fetch('/api/server-status',{cache:'no-store',signal:AbortSignal.timeout(10000)});const d=await r.json();if(!r.ok)throw new Error(d.error||'读取失败');renderServerStatus(d)}catch(e){renderServerError('状态服务不可用')}}
        function renderServerStatus(d){const c=(d.connectivity||'UNKNOWN').toUpperCase(),level=c==='ONLINE'?'online':c==='OFFLINE'?'offline':c==='STALE'?'stale':'unknown';document.getElementById('serverUpdated').textContent=d.checked_at?'检测于 '+fmtTs(d.checked_at):'暂无检测时间';const ports=Object.entries({...d.ports,icmp:Boolean(d.ping)}).map(([k,v])=>'<span class="port-chip '+(v?'open':'')+'">'+esc(k.toUpperCase())+' '+(v?'OPEN':'CLOSED')+'</span>').join('');document.getElementById('serverBody').innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;"><span class="status-pill '+level+'"><span>●</span>'+esc(c)+'</span><span style="font-size:12px;color:var(--sub);">服务器地址：<b style="color:var(--text);">'+esc(d.host||'UNKNOWN')+'</b></span></div><div class="info-grid"><div class="info-item"><div class="label">系统信息</div><div class="value">'+esc(d.status||'UNKNOWN')+'</div></div><div class="info-item"><div class="label">最近状态变更</div><div class="value" style="font-size:12px;">'+fmtStateChange(d.last_state_change_at)+'</div></div></div><div class="limit-msg '+level+'" style="text-align:left;">'+esc(d.reason||'暂无判定理由')+(d.consecutive_offline_count>0?'（离线采样 '+d.consecutive_offline_count+' 次）':'')+'</div><div class="port-list">'+(ports||'<span class="port-chip">暂无端口数据</span>')+'</div><button class="btn btn-outline" style="margin-top:12px;" onclick="fetchServerStatus()">↻ 刷新服务器状态</button>';}
        function renderServerError(msg){document.getElementById('serverUpdated').textContent='读取失败';document.getElementById('serverBody').innerHTML='<div style="min-height:150px;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div class="limit-msg danger" style="text-align:center;">⚠️ '+esc(msg)+'</div><button class="btn btn-outline" style="width:auto;margin-top:12px;" onclick="fetchServerStatus()">↻ 重试</button></div>'}
        function fmtStateChange(v){return v?fmtTs(v):'1970/1/1 0:00'}
        async function fetchParkData(){
            const plate=loadPlate();
            try{
                const resp=await fetch('/api/detail?plate='+encodeURIComponent(plate),{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(12000)});
                const data=await resp.json();
                if(data.success){parkData=data;renderParkData(data);startTick()}
                else renderEmpty('车辆不在停车场内')
            }catch(e){renderEmpty('网络异常')}
        }
        function loadPlate(){
            try{return JSON.parse(localStorage.getItem('hainanu_board_plate')||'{}').plate||'琼A054DB'}catch(e){return '琼A054DB'}
        }
        function renderParkData(d){
            const card=document.getElementById('parkCard');card.style.display='';card.style.flexDirection='';
            const el=document.getElementById('parkBody');el.style.display='';el.style.flexDirection='';el.style.flex='';
            document.getElementById('parkName').textContent=d.parkName||'海南大学海甸校区';
            const plate=d.plate||'--';
            if(d.bill?.paid){
                const fm=d.bill.freeMin||0,fh=Math.floor(fm/60),fmm=fm%60;
                const fs=fh>0?fh+'h'+fmm+'m':fmm+'m';
                const nc=d.bill.nextChargeMin>0?'<span style="font-size:11px;color:var(--sub);">'+nextChargeText(d.bill.nextChargeMin,d.bill.nextChargeFee)+'</span>':'';
                el.innerHTML='<div class="plate-row"><div class="plate-tag">'+esc(fmtPlate(plate))+'</div><div class="park-status parked"><span class="dot"></span>已缴费未驶出</div></div>'+
                '<div class="info-grid"><div class="info-item"><div class="label">剩余免费停车时间</div><div class="value" style="font-size:12px;">'+esc(fs)+'</div></div>'+
                '<div class="info-item"><div class="label">停车时长</div><div class="value">'+fmtDur(parseInt(d.bill.durationMinutes))+'</div></div>'+
                '<div class="info-item" style="grid-column:1/-1;"><div class="label">应缴金额</div>'+
                '<div style="display:flex;justify-content:space-between;align-items:baseline;">'+
                '<span class="value fee" style="color:var(--green);">¥0.00</span>'+nc+'</div></div></div>'+
                '<div class="limit-msg safe" style="text-align:center;">✅ 已缴费，请尽快驶出停车场!</div>'+
                '<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-pay" style="background:#a0c8a8;cursor:not-allowed;box-shadow:none;" disabled>已缴费</button><button class="btn btn-outline" style="width:auto;flex-shrink:0;padding:12px 14px;" onclick="fetchParkData()" title="刷新">&#x1f504;</button></div>';
                return;
            }
            const entryStr=d.bill?.entryTimeStr||fmtTs(d.entryTime)||'--';
            const fee=d.bill?.totalFee!=null?Number(d.bill.totalFee).toFixed(2):null;
            const parkMin=d.bill?.durationMinutes!=null?parseInt(d.bill.durationMinutes):null;
            const hours=parkMin!==null?Math.floor(parkMin/60):null,level=hours!==null?getLevel(hours):'safe';
            el.innerHTML=
                '<div class="plate-row"><div class="plate-tag">'+esc(fmtPlate(plate))+'</div><div class="park-status parked"><span class="dot"></span>停车中</div></div>'+
                '<div class="info-grid">'+
                '<div class="info-item"><div class="label">入场时间</div><div class="value" style="font-size:12px;">'+esc(entryStr)+'</div></div>'+
                '<div class="info-item"><div class="label">停车时长</div><div class="value" id="durVal">'+fmtDur(parkMin)+'</div></div>'+
                '<div class="info-item" style="grid-column:1/-1;"><div class="label">应缴金额</div><div style="display:flex;justify-content:space-between;align-items:baseline;"><span class="value fee">'+(fee!=null?'¥'+fee:'--')+'</span>'+
                (d.bill?.nextChargeMin>0?'<span style="font-size:11px;color:var(--sub);">'+nextChargeText(d.bill.nextChargeMin,d.bill.nextChargeFee)+'</span>':'')+
                '</div></div></div>'+
                (hours!==null?
                '<div class="limit-bar"><div class="labels"><span>0h</span><span>48h</span></div><div class="track"><div class="fill '+level+'" id="limitFill" style="width:'+Math.min(100,hours/LIMIT_H*100)+'%"></div></div></div>'+
                '<div class="limit-msg '+level+'" id="limitMsg">'+limitMsg(hours)+'</div>':'')+
                '<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-pay" onclick="goPay()">快捷缴费</button><button class="btn btn-outline" style="width:auto;flex-shrink:0;padding:12px 14px;" onclick="fetchParkData()" title="刷新">&#x1f504;</button></div>';
        }
        function renderEmpty(msg){
            document.getElementById('parkName').textContent=parkData?.parkName||'暂无记录';
            const plate=parkData?.plate||loadPlate();
            const card=document.getElementById('parkCard');card.style.display='flex';card.style.flexDirection='column';
            const el=document.getElementById('parkBody');el.style.display='flex';el.style.flexDirection='column';el.style.flex='1';
            el.innerHTML='<div class="plate-row"><div class="plate-tag">'+esc(fmtPlate(plate))+'</div><div class="park-status" style="color:var(--red);"><span class="dot" style="background:var(--red);animation:none;"></span>未入场</div></div><div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--sub);"><div style="text-align:center;"><div style="font-size:36px;margin-bottom:6px;">&#x1f697;</div><p style="font-size:13px;">'+esc(msg)+'</p><button class="btn btn-outline" style="margin-top:12px;" onclick="fetchParkData()">&#x1f504; 重新查询</button></div></div>';
            clearInterval(tickTimer);
        }
        function startTick(){
            clearInterval(tickTimer);
            tickTimer=setInterval(()=>{
                if(parkData?.bill?.paid){if(parkData.bill.freeMin>0)parkData.bill.freeMin=Math.max(0,parkData.bill.freeMin-10/60);if(parkData.bill.nextChargeMin>0)parkData.bill.nextChargeMin=Math.max(0,parkData.bill.nextChargeMin-10/60);return}
                if(parkData?.bill?.durationMinutes==null)return;
                parkData.bill.durationMinutes=parseInt(parkData.bill.durationMinutes)+10/60;
                const min=Math.floor(parkData.bill.durationMinutes),durEl=document.getElementById('durVal');
                if(durEl)durEl.textContent=fmtDur(min);
                const h=Math.floor(min/60),level=getLevel(h),fill=document.getElementById('limitFill');
                if(fill){fill.style.width=Math.min(100,h/LIMIT_H*100)+'%';fill.className='fill '+level}
                const msg=document.getElementById('limitMsg');
                if(msg){msg.textContent=limitMsg(h);msg.className='limit-msg '+level}
                if(parkData.bill.nextChargeMin>0)parkData.bill.nextChargeMin=Math.max(0,parkData.bill.nextChargeMin-10/60);
            },10000);
        }
        function goPay(){if(parkData?.payUrl)window.location.href=parkData.payUrl;else fetchParkData().then(()=>{if(parkData?.payUrl)window.location.href=parkData.payUrl})}
        function getLevel(h){if(h>=DANGER_H)return 'danger';if(h>=WARN_H)return 'alert';return 'safe'}
        function limitMsg(h){const left=LIMIT_H-h;if(h>=DANGER_H)return '⚠️ 仅剩 '+left+' 小时达拉黑线，请尽快缴费离场';if(h>=WARN_H)return '⏰ 已停 '+h+' 小时，距拉黑线还有 '+left+' 小时';return '✅ 停车时长正常，距拉黑线还有 '+left+' 小时'}
        function fmtDur(min){if(min==null)return '--';const d=Math.floor(min/1440),h=Math.floor((min%1440)/60),m=min%60;if(d>0)return d+'天'+h+'小时'+m+'分';if(h>0)return h+'小时'+m+'分';return m+'分钟'}
        function fmtTs(ts){if(!ts)return null;const d=new Date(ts);return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
        function nextChargeText(min,fee){const h=Math.floor(min/60),m=min%60;let s=h>0?h+'h':'';if(m>0||h===0)s+=m+'m';s+=' 后加¥'+(fee!=null?fee:'?');return s}
        function fmtPlate(p){if(!p||p.length<3)return p;return p.slice(0,2)+'·'+p.slice(2)}
        function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
    </script>
</body>
</html>`;
