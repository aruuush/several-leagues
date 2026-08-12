// ==UserScript==
// @name         Several Leagues
// @namespace    hh-several-leagues
// @version      5.0.0
// @author       Arush
// @description  Several League enhancements (Only Tested on Hentai Heroes)
// @match        *://*.hentaiheroes.com/*leagues.html*
// @match        *://*.haremheroes.com/*leagues.html*
// @match        *://*.gayharem.com/*leagues.html*
// @match        *://*.comixharem.com/*leagues.html*
// @match        *://*.hornyheroes.com/*leagues.html*
// @match        *://*.pornstarharem.com/*leagues.html*
// @match        *://*.transpornstarharem.com/*leagues.html*
// @match        *://*.gaypornstarharem.com/*leagues.html*
// @match        *://*.mangarpg.com/*leagues.html*
// @match        *://*.hentaiheroes.com/*home.html*
// @match        *://*.haremheroes.com/*home.html*
// @match        *://*.gayharem.com/*home.html*
// @match        *://*.comixharem.com/*home.html*
// @match        *://*.hornyheroes.com/*home.html*
// @match        *://*.pornstarharem.com/*home.html*
// @match        *://*.transpornstarharem.com/*home.html*
// @match        *://*.gaypornstarharem.com/*home.html*
// @match        *://*.mangarpg.com/*home.html*
// @downloadURL  https://raw.githubusercontent.com/aruuush/several-leagues/main/several_leagues.user.js
// @updateURL    https://raw.githubusercontent.com/aruuush/several-leagues/main/several_leagues.user.js
// @icon         https://cdn3.iconfinder.com/data/icons/sex-6/128/XXX_3-02-512.png
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_info
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.xmlHttpRequest
// @connect      api.github.com
// ==/UserScript==

if (unsafeWindow.__severalLeaguesInitialized) {
    return;
}
unsafeWindow.__severalLeaguesInitialized = true;

function waitForHHPlusPlus(cb) {
    if (unsafeWindow.hhPlusPlusConfig) {
        cb();
        return;
    }

    let done = false;

    const finish = () => {
        if (done) return;
        done = true;
        cb();
    };

    document.addEventListener('hh++-bdsm:loaded', finish, { once: true });

    const poll = setInterval(() => {
        if (unsafeWindow.hhPlusPlusConfig) {
            clearInterval(poll);
            finish();
        }
    }, 10);
}

const SITE_SUFFIX_TO_PREFIX = [
    ['hentaiheroes.com', 'hh'],
    ['haremheroes.com', 'hh'],
    ['gayharem.com', 'gh'],
    ['comixharem.com', 'ch'],
    ['hornyheroes.com', 'hoh'],
    ['pornstarharem.com', 'psh'],
    ['transpornstarharem.com', 'tpsh'],
    ['gaypornstarharem.com', 'gpsh'],
    ['mangarpg.com', 'mrpg']
];

function resolvePrefix() {
    const host = location.hostname.toLowerCase();

    for (const [suffix, prefix] of SITE_SUFFIX_TO_PREFIX) {
        if (host === suffix || host.includes(`.${suffix}`)) {
            return prefix;
        }
    }

    return 'hh'; // safe fallback
}

async function severalLeagues() {
    'use strict';

    const prefix = resolvePrefix();

    const STARRED_KEY = `${prefix}_league_starred_players`;
    const FILTER_MODE_KEY = `${prefix}_league_star_filter_mode`;
    const SORT_KEY = `${prefix}_league_sort_state`;
    const INSTABOOSTER_KEY = `${prefix}_league_instabooster_config`;
    const INSTABOOSTER_PLAYER_HISTORY_KEY = `${prefix}_league_instaboosted_players`;
    const HISTORY_KEY = `${prefix}_league_booster_history`;
    // GM-local cache: which flagged archived players reappear in the current bracket.
    const REAPPEARS_KEY = `${prefix}_league_reappears_snapshot`;
    // GM-local bookkeeping: last-modified time for the synced threshold setting (LWW).
    const SETTINGS_AT_KEY = `${prefix}_sl_settings_updated_at`;

    const INSTABOOSTER_THRESHOLD_DEFAULT = 10; // seconds
    const BATCH_GAP_THRESHOLD = 10; // seconds
    const MAX_DISPLAY_BATCHES = 8; // tooltip can't show more than this anyway
    let instaBoosterThreshold = GM_getValue(INSTABOOSTER_KEY, INSTABOOSTER_THRESHOLD_DEFAULT);

    // ------------ Utility ------------
    const fmt = (ts) =>
        new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // ==================================================================
    // ===================== GitHub Sync Layer ==========================
    // ==================================================================
    // Reuses window.LeagueTrackerGitHubConfig (from the HH League Tracker
    // config script). If it's missing, every sync call becomes a silent
    // no-op and the script behaves exactly as it did before this feature.
    //
    // Files written (all under the user's own repo):
    //   several_leagues/<platform>/<myId>/starred.json          (personal stars)
    //   several_leagues/<platform>/<myId>/booster_history.json  (current-league history)
    //   several_leagues/<platform>/<myId>/flagged_archive.json  (cross-league watchlist)
    //
    // GM-local (never synced): the reappears snapshot cache.
    // ==================================================================
    const gitHubSync = createGitHubSync();

    function createGitHubSync() {
        const cfg = unsafeWindow.LeagueTrackerGitHubConfig;
        const configPresent = !!(cfg && cfg.owner && cfg.repo && cfg.token);

        if (!configPresent) {
            console.info('Several Leagues: LeagueTrackerGitHubConfig not found — GitHub sync disabled (local only).');
        }

        // Runtime master switch, set from the HH++ config toggle after load.
        // Sync only runs when the config is present AND the toggle is on.
        const state = { toggleOn: true };
        const isEnabled = () => configPresent && state.toggleOn;

        const shared = unsafeWindow.shared;
        const platform = shared?.Hero?.infos?.hh_universe || prefix;
        const myId = shared?.Hero?.infos?.id ?? 'unknown';
        const playerName = shared?.Hero?.infos?.name || 'player';
        const base = `several_leagues/${platform}/${myId}`;

        const PATHS = {
            starred: `${base}/starred.json`,
            history: `${base}/booster_history.json`,
            archive: `${base}/flagged_archive.json`,
            settings: `${base}/settings.json`,
        };

        // local bookkeeping for sha handles (never synced, device-local)
        const SHA = {
            starred: `${prefix}_sl_sha_starred`,
            history: `${prefix}_sl_sha_history`,
            archive: `${prefix}_sl_sha_archive`,
            settings: `${prefix}_sl_sha_settings`,
        };

        // ---- base64 <-> JSON, UTF-8 safe ----
        const encode = (obj) => {
            const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
            let bin = '';
            for (const b of bytes) bin += String.fromCharCode(b);
            return btoa(bin);
        };
        const decode = (b64) => {
            const bin = atob(String(b64).replace(/\s/g, ''));
            const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
            return JSON.parse(new TextDecoder().decode(bytes));
        };

        const url = (path) => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

        // prefixed logger, mirrors the League Tracker's info()
        const info = (...args) => console.log('Several Leagues:', ...args);

        async function ghGet(path) {
            info(`reading ${path}`);
            const res = await GM.xmlHttpRequest({
                method: 'GET',
                url: url(path),
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${cfg.token}`,
                    'If-None-Match': '', // dodge GitHub's ETag cache
                },
            });
            if (res.status === 404) { info(`${path} doesn't exist yet`); return { missing: true }; }
            if (res.status !== 200) throw new Error(`GET ${path} -> ${res.status}`);
            const body = JSON.parse(res.responseText);
            return { data: decode(body.content), sha: body.sha };
        }

        async function ghPut(path, obj, sha, action) {
            info(`${action} ${path}`);
            const payload = {
                message: `${new Date().toISOString()} [${playerName}] ${action} ${path}`,
                content: encode(obj),
            };
            if (sha) payload.sha = sha;
            const res = await GM.xmlHttpRequest({
                method: 'PUT',
                url: url(path),
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${cfg.token}`,
                },
                data: JSON.stringify(payload),
            });
            if (res.status !== 200 && res.status !== 201) throw new Error(`PUT ${path} -> ${res.status}`);
            return JSON.parse(res.responseText).content.sha;
        }

        // PUT with one automatic sha-refresh on conflict (handles the rare
        // multi-device collision; single writer means this almost never fires).
        async function ghPutSafe(path, obj, shaKey, action) {
            try {
                const newSha = await ghPut(path, obj, GM_getValue(shaKey, null), action);
                GM_setValue(shaKey, newSha);
                return newSha;
            } catch (e) {
                const cur = await ghGet(path);
                const newSha = await ghPut(path, obj, cur.missing ? null : cur.sha, action);
                GM_setValue(shaKey, newSha);
                return newSha;
            }
        }

        const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r({ __timeout: true }), ms))]);

        return { isEnabled, configPresent, state, ghGet, ghPutSafe, PATHS, SHA, withTimeout, info };
    }

    // ---- batch coercion at the GitHub boundary (defensive) ----
    // Every batch that crosses into memory from a synced/stored source is
    // normalized to { id, lifetime:Number } and bad entries are dropped.
    function coerceBatch(rawBatch) {
        if (!Array.isArray(rawBatch)) return [];
        return rawBatch
            .map(b => (typeof b === 'number'
                ? { id: null, lifetime: b }
                : { id: b?.id ?? null, lifetime: Number(b?.lifetime) }))
            .filter(b => Number.isFinite(b.lifetime));
    }

    // lifetime-signature of a batch, for dedupe/merge (order-independent)
    const batchSig = (batch) => batch.map(b => b.lifetime).sort((a, b) => a - b).join(',');

    // ==================================================================
    // ============= Convert-on-read seam (migrations) ==================
    // ==================================================================
    // Single place each structure's persisted data passes through on read.
    // Today most are identity/passthrough; future shape changes slot in here.
    // `version ?? 1` is the migration signal for the new structures.

    // STARRED: local key is being canonicalized from a bare array to
    // { version, updatedAt, starred:[...] }. One-time convert-on-read.
    function readStarredLocal() {
        const raw = GM_getValue(STARRED_KEY, null);
        if (raw == null) {
            return { version: 1, updatedAt: 0, starred: [] };
        }
        // legacy: bare array
        if (Array.isArray(raw)) {
            const migrated = { version: 1, updatedAt: Date.now(), starred: raw.map(String) };
            GM_setValue(STARRED_KEY, migrated);
            return migrated;
        }
        // current wrapped shape (defensive fill)
        const v = raw.version ?? 1;
        return {
            version: v,
            updatedAt: Number(raw.updatedAt) || 0,
            starred: Array.isArray(raw.starred) ? raw.starred.map(String) : [],
        };
    }
    function writeStarredLocal(starredArr, updatedAt) {
        GM_setValue(STARRED_KEY, {
            version: 1,
            updatedAt: updatedAt ?? Date.now(),
            starred: [...new Set(starredArr.map(String))],
        });
    }

    // HISTORY: local key canonicalized from { leagueKey, history } to
    // { version, leagueKey, history }. One-time convert-on-read.
    function readHistoryLocal() {
        const raw = GM_getValue(HISTORY_KEY, null);
        if (raw == null) return { version: 1, leagueKey: null, history: {} };
        const v = raw.version ?? 1;
        const out = {
            version: v,
            leagueKey: raw.leagueKey ?? null,
            history: raw.history && typeof raw.history === 'object' ? raw.history : {},
        };
        if (raw.version == null) {
            // stamp version onto legacy shape once
            GM_setValue(HISTORY_KEY, out);
        }
        return out;
    }
    function writeHistoryLocal(leagueKey, history) {
        GM_setValue(HISTORY_KEY, { version: 1, leagueKey, history });
    }

    // ARCHIVE (remote): { version, players: { id: batches[] } }
    function migrateArchive(data) {
        if (!data || typeof data !== 'object') return { version: 1, players: {} };
        const players = data.players && typeof data.players === 'object' ? data.players : {};
        const cleaned = {};
        for (const id in players) {
            const batches = (Array.isArray(players[id]) ? players[id] : [])
                .map(coerceBatch)
                .filter(b => b.length);
            if (batches.length) cleaned[id] = batches;
        }
        return { version: 1, players: cleaned };
    }

    // REAPPEARS snapshot (GM-local): { version, leagueKey, players: { id: batches[] } }
    function readReappears(currentLeagueKey) {
        const raw = GM_getValue(REAPPEARS_KEY, null);
        if (!raw || typeof raw !== 'object') return null;
        if (raw.leagueKey !== currentLeagueKey) return null; // stale -> ignore (rebuilt at reset)
        const players = raw.players && typeof raw.players === 'object' ? raw.players : {};
        const out = {};
        for (const id in players) {
            const batches = (Array.isArray(players[id]) ? players[id] : [])
                .map(coerceBatch)
                .filter(b => b.length);
            if (batches.length) out[id] = batches;
        }
        return out;
    }
    function writeReappears(leagueKey, players) {
        GM_setValue(REAPPEARS_KEY, { version: 1, leagueKey, players });
    }

    // ---- populate the in-memory display seed from the reappears snapshot ----
    // Reads the GM-local snapshot for the current league and tags each batch
    // fromArchive:true. Called at collection time and again after a reset fold
    // rebuilds the snapshot. Never writes into live history.
    function seedFromReappears() {
        const reappears = readReappears(server_now_ts + season_end_at) || {};
        window.__seededArchive = {};
        for (const id in reappears) {
            window.__seededArchive[id] = reappears[id].map(batch =>
                batch.map(b => ({ id: b.id, lifetime: b.lifetime, fromArchive: true }))
            );
        }
    }

    // ---- archive merge: union of batches per player, deduped by signature,
    //      newest-first, capped to MAX_DISPLAY_BATCHES. Prefers the copy that
    //      carries real booster ids over a null-id copy. ----
    function foldBatchesIntoArchive(existingBatches, incomingBatches) {
        const bySig = new Map();
        const consider = (batch) => {
            const b = coerceBatch(batch);
            if (!b.length) return;
            const key = batchSig(b);
            const hasReal = b.some(x => x.id != null);
            const prev = bySig.get(key);
            if (!prev || (hasReal && !prev.some(x => x.id != null))) bySig.set(key, b);
        };
        (existingBatches || []).forEach(consider);
        (incomingBatches || []).forEach(consider);

        // newest-first by the batch's latest lifetime, cap to display limit
        return [...bySig.values()]
            .sort((a, b) => Math.max(...b.map(x => x.lifetime)) - Math.max(...a.map(x => x.lifetime)))
            .slice(0, MAX_DISPLAY_BATCHES);
    }

    // ==================================================================
    // ==================== Sync operations =============================
    // ==================================================================

    // ---- STARS (last-write-wins via updatedAt, reconciled on load) ----
    // Returns true if local stars changed (so rows can be re-decorated).
    async function syncStars() {
        if (!gitHubSync.isEnabled()) return false;
        const local = readStarredLocal();

        let remote;
        try {
            remote = await gitHubSync.ghGet(gitHubSync.PATHS.starred);
        } catch (e) {
            console.warn('Several Leagues: starred sync failed', e);
            return false;
        }

        if (remote.missing) {
            const at = local.updatedAt || Date.now();
            writeStarredLocal(local.starred, at);
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.starred,
                { version: 1, updatedAt: at, starred: [...new Set(local.starred.map(String))] },
                gitHubSync.SHA.starred, 'create'
            );
            return false;
        }
        GM_setValue(gitHubSync.SHA.starred, remote.sha);

        const rd = remote.data || {};
        const remoteAt = Number(rd.updatedAt) || 0;
        const remoteArr = Array.isArray(rd.starred) ? rd.starred.map(String)
            : (Array.isArray(rd) ? rd.map(String) : []); // defensive: bare array remote

        if (remoteAt > local.updatedAt) {
            writeStarredLocal(remoteArr, remoteAt);
            return true; // caller re-decorates rows
        } else if (local.updatedAt > remoteAt) {
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.starred,
                { version: 1, updatedAt: local.updatedAt, starred: [...new Set(local.starred.map(String))] },
                gitHubSync.SHA.starred, 'update'
            );
        } else {
            gitHubSync.info('stars unchanged, no need to update');
        }
        return false;
    }

    // ---- SETTINGS / THRESHOLD (last-write-wins via updatedAt, reconciled on load) ----
    async function syncSettings() {
        if (!gitHubSync.isEnabled()) return;
        const localThreshold = GM_getValue(INSTABOOSTER_KEY, INSTABOOSTER_THRESHOLD_DEFAULT);
        const localAt = Number(GM_getValue(SETTINGS_AT_KEY, 0)) || 0;

        let remote;
        try {
            remote = await gitHubSync.ghGet(gitHubSync.PATHS.settings);
        } catch (e) {
            console.warn('Several Leagues: settings sync failed', e);
            return;
        }

        if (remote.missing) {
            const at = localAt || Date.now();
            GM_setValue(SETTINGS_AT_KEY, at);
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.settings,
                { version: 1, updatedAt: at, instaBoosterThreshold: localThreshold },
                gitHubSync.SHA.settings, 'create'
            );
            return;
        }
        GM_setValue(gitHubSync.SHA.settings, remote.sha);

        const rd = remote.data || {};
        const remoteAt = Number(rd.updatedAt) || 0;
        const remoteThreshold = Number(rd.instaBoosterThreshold);

        if (remoteAt > localAt && Number.isFinite(remoteThreshold)) {
            GM_setValue(INSTABOOSTER_KEY, remoteThreshold);
            GM_setValue(SETTINGS_AT_KEY, remoteAt);
            instaBoosterThreshold = remoteThreshold;
            // reflect into the config input if it's already rendered
            const input = document.querySelector('#insta-booster-threshold');
            if (input) input.value = String(remoteThreshold);
        } else if (localAt > remoteAt) {
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.settings,
                { version: 1, updatedAt: localAt, instaBoosterThreshold: localThreshold },
                gitHubSync.SHA.settings, 'update'
            );
        } else {
            gitHubSync.info('settings unchanged, no need to update');
        }
    }

    // ---- HISTORY (union-merge for cross-device; push only on change) ----
    async function syncHistory(currentLeagueKey) {
        if (!gitHubSync.isEnabled()) return;
        const local = readHistoryLocal();
        const localHistory = (local.leagueKey === currentLeagueKey && local.history) ? local.history : {};

        let remote;
        try {
            remote = await gitHubSync.ghGet(gitHubSync.PATHS.history);
        } catch (e) {
            console.warn('Several Leagues: history sync failed', e);
            return;
        }

        if (remote.missing) {
            writeHistoryLocal(currentLeagueKey, localHistory);
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.history,
                { version: 1, leagueKey: currentLeagueKey, history: localHistory },
                gitHubSync.SHA.history, 'create'
            );
            return;
        }
        GM_setValue(gitHubSync.SHA.history, remote.sha);

        const rd = remote.data || {};
        // remote is for a different (older) league -> our current-league data wins
        if (rd.leagueKey !== currentLeagueKey) {
            writeHistoryLocal(currentLeagueKey, localHistory);
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.history,
                { version: 1, leagueKey: currentLeagueKey, history: localHistory },
                gitHubSync.SHA.history, 'reset'
            );
            return;
        }

        // same league: UNION-merge remote into local so batches seen on either
        // device survive. Re-read local at merge time (buildBoosterExpiryMap may
        // have written this page's observations while the pull was in flight).
        const remoteHistory = rd.history && typeof rd.history === 'object' ? rd.history : {};
        const freshLocal = readHistoryLocal();
        const baseHistory = (freshLocal.leagueKey === currentLeagueKey && freshLocal.history) ? freshLocal.history : {};

        const merged = mergeHistoriesUnion(baseHistory, remoteHistory);

        const mergedStr = JSON.stringify(merged);
        const localDiffers = mergedStr !== JSON.stringify(baseHistory);
        const remoteDiffers = mergedStr !== JSON.stringify(remoteHistory);

        if (localDiffers) {
            writeHistoryLocal(currentLeagueKey, merged);
            if (typeof onHistoryChanged === 'function') onHistoryChanged();
        }
        // push if the merged result differs from what remote had
        if (remoteDiffers) {
            await gitHubSync.ghPutSafe(
                gitHubSync.PATHS.history,
                { version: 1, leagueKey: currentLeagueKey, history: merged },
                gitHubSync.SHA.history, 'update'
            );
        }
        if (!localDiffers && !remoteDiffers) {
            gitHubSync.info('history unchanged, no need to update');
        }
    }

    // union of two histories: per player, union of batches deduped by lifetime
    // signature, preferring the copy that carries real booster ids.
    function mergeHistoriesUnion(a = {}, b = {}) {
        const out = {};
        const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const id of ids) {
            const bySig = new Map();
            const consider = (rawBatch) => {
                const batch = coerceBatch(rawBatch);
                if (!batch.length) return;
                const key = batchSig(batch);
                const hasReal = batch.some(x => x.id != null);
                const prev = bySig.get(key);
                if (!prev || (hasReal && !prev.some(x => x.id != null))) bySig.set(key, batch);
            };
            (a[id] || []).forEach(consider);
            (b[id] || []).forEach(consider);
            if (bySig.size) out[id] = [...bySig.values()];
        }
        return out;
    }

    // ---- ARCHIVE + REAPPEARS (reset-time fold, then seed on every load) ----
    // Called at reset detection, BEFORE the live history is wiped. `outgoing`
    // is last league's flagged players => { id: batches[] }. Roster is this
    // league's opponent ids. Returns nothing; writes archive to GitHub and the
    // reappears snapshot to GM storage.
    async function foldAndBuildReappears(currentLeagueKey, outgoingFlagged, rosterIds) {
        if (!gitHubSync.isEnabled()) {
            // still build a local reappears snapshot from... nothing remote.
            // Without sync there's no archive, so no cross-league seeding.
            writeReappears(currentLeagueKey, {});
            return;
        }

        let archive = { version: 1, players: {} };
        try {
            const remote = await gitHubSync.ghGet(gitHubSync.PATHS.archive);
            if (remote.missing) {
                archive = { version: 1, players: {} };
            } else {
                GM_setValue(gitHubSync.SHA.archive, remote.sha);
                archive = migrateArchive(remote.data);
            }
        } catch (e) {
            console.warn('Several Leagues: archive pull failed; skipping fold this reset', e);
            writeReappears(currentLeagueKey, {});
            return;
        }

        // fold outgoing flagged players into the archive
        let changed = false;
        for (const id in outgoingFlagged) {
            const incoming = outgoingFlagged[id];
            if (!incoming || !incoming.length) continue;
            const before = archive.players[id] || [];
            const folded = foldBatchesIntoArchive(before, incoming);
            if (JSON.stringify(folded) !== JSON.stringify(before)) changed = true;
            archive.players[id] = folded;
        }

        if (changed) {
            try {
                await gitHubSync.ghPutSafe(
                    gitHubSync.PATHS.archive, archive, gitHubSync.SHA.archive, 'update'
                );
            } catch (e) {
                console.warn('Several Leagues: archive push failed', e);
            }
        } else {
            gitHubSync.info('archive unchanged, no need to update');
        }

        // build reappears = archive ∩ current roster
        const rosterSet = new Set(rosterIds.map(String));
        const players = {};
        for (const id in archive.players) {
            if (rosterSet.has(String(id))) players[id] = archive.players[id];
        }
        writeReappears(currentLeagueKey, players);
    }

    // ------------ Star League Players ------------
    function starInit() {
        function loadStarred() {
            try {
                return new Set(readStarredLocal().starred);
            } catch (e) {
                console.error('Several Leagues: Failed to load starred players', e);
                return new Set();
            }
        }

        function saveStarred(set) {
            try {
                // Local only — bumps updatedAt so the next load's reconcile
                // knows local is newer and pushes it. No push on toggle.
                writeStarredLocal([...set], Date.now());
            } catch (e) {
                console.error('Several Leagues: Failed to save starred players', e);
            }
        }

        function isMyRow(row) {
            return row.classList.contains('player-row');
        }

        function getAllRows() {
            return [...document.querySelectorAll('.data-row.body-row')];
        }

        function getMemberIdFromRow(row) {
            const nickSpan = row.querySelector('.data-column[column="nickname"] .nickname[id-member]');
            return nickSpan ? nickSpan.getAttribute('id-member') : null;
        }

        function createStarElement(isStarred, hidden = false) {
            const star = document.createElement('span');
            star.className = 'hh-star-toggle';
            star.textContent = isStarred ? '\u2605' : '\u2606';
            star.style.cursor = 'pointer';
            star.style.marginRight = '0.3rem';
            star.style.fontSize = '1.3rem';
            star.style.userSelect = 'none';
            star.style.color = isStarred ? '#ffd700' : '#bbb';
            star.style.verticalAlign = 'middle';
            if (hidden) {
                star.style.visibility = 'hidden';
            }
            return star;
        }

        function decorateRows(starredSet) {
            getAllRows().forEach(row => {
                const nicknameCell = row.querySelector('.data-column[column="nickname"]');
                if (!nicknameCell) return;

                // Already processed?
                if (nicknameCell.querySelector('.hh-star-toggle')) return;

                const memberId = getMemberIdFromRow(row);
                if (!memberId) return;

                const isMySelf = isMyRow(row);

                let starEl;

                if (isMySelf) {
                    // Create invisible placeholder
                    starEl = document.createElement('span');
                    starEl.className = 'hh-star-toggle';
                    starEl.textContent = '\u2606';
                    starEl.style.visibility = 'hidden';
                    starEl.style.marginRight = '0.3rem';
                    starEl.style.fontSize = '1.3rem';
                    starEl.style.userSelect = 'none';
                } else {
                    // Normal star logic
                    const isStarred = starredSet.has(memberId);
                    starEl = createStarElement(isStarred);

                    starEl.addEventListener('click', e => {
                        e.stopPropagation();
                        const currentlyStarred = starredSet.has(memberId);

                        if (currentlyStarred) {
                            starredSet.delete(memberId);
                        } else {
                            starredSet.add(memberId);
                        }

                        saveStarred(starredSet);
                        updateStarVisual(starEl, !currentlyStarred);

                        const mode = GM_getValue(FILTER_MODE_KEY, 'all');
                        applyModeFilter(starredSet, mode);
                    });
                }

                const avatar = nicknameCell.querySelector('.square-avatar-wrapper');
                if (avatar) {
                    avatar.parentNode.insertBefore(starEl, avatar);
                } else {
                    nicknameCell.insertBefore(starEl, nicknameCell.firstChild);
                }
            });
        }

        function updateStarVisual(el, isStarred) {
            el.textContent = isStarred ? '\u2605' : '\u2606';
            el.style.color = isStarred ? '#ffd700' : '#bbb';
        }

        function styleFilterBtn(btn) {
            btn.style.padding = '0rem 0.6rem';
            btn.style.borderRadius = '4px';
            btn.style.border = '0px';
            btn.style.background = 'transparent';
            btn.style.color = '#fff';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '1rem';
            btn.style.width = '49%';
        }

        function applyModeFilter(starredSet, mode) {

            document.querySelectorAll('.data-row.body-row').forEach(row => {
                const id = getMemberIdFromRow(row);
                const isStar = id && starredSet.has(id);

                // ALWAYS show my own row
                if (isMyRow(row)) {
                    row.style.display = '';
                    return;
                }

                let show = true;

                if (mode === "starred") show = isStar;
                else if (mode === "nonstar") show = !isStar;
                else show = true;

                row.style.display = show ? "" : "none";
            });
        }

        function createFilterButton(starredSet) {
            let btnStar = document.querySelector('#hh-filter-star');
            let btnNonStar = document.querySelector('#hh-filter-nonstar');

            if (btnStar && btnNonStar) return;

            // Create buttons
            btnStar = document.createElement('button');
            btnStar.id = 'hh-filter-star';
            styleFilterBtn(btnStar);
            btnStar.textContent = "\u2605"; // gold star
            btnStar.style.color = '#ffd700';

            btnNonStar = document.createElement('button');
            btnNonStar.id = 'hh-filter-nonstar';
            styleFilterBtn(btnNonStar);
            btnNonStar.textContent = "\u2606"; // empty star

            const filterBox = document.querySelector('.league_filter_box');

            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.gap = '0.4rem';
            wrapper.style.marginTop = '0.4rem';
            wrapper.style.marginBottom = '0.4rem';

            wrapper.appendChild(btnStar);
            wrapper.appendChild(btnNonStar);
            filterBox.appendChild(wrapper);

            // Load state
            let mode = GM_getValue(FILTER_MODE_KEY, 'all');
            updateModeButtons();

            // Button logic
            btnStar.addEventListener('click', () => {
                mode = (mode === "starred" ? "all" : "starred");
                GM_setValue(FILTER_MODE_KEY, mode);
                updateModeButtons();
                applyModeFilter(starredSet, mode);
            });

            btnNonStar.addEventListener('click', () => {
                mode = (mode === "nonstar" ? "all" : "nonstar");
                GM_setValue(FILTER_MODE_KEY, mode);
                updateModeButtons();
                applyModeFilter(starredSet, mode);
            });

            // Initial apply
            applyModeFilter(starredSet, mode);

            function updateModeButtons() {
                btnStar.style.background = (mode === "starred" ? "#fff8" : "transparent");
                btnNonStar.style.background = (mode === "nonstar" ? "#fff8" : "transparent");
            }
        }

        const starredSet = loadStarred();

        const levelHeader = document.querySelector('.data-column.head-column[column="level"]');
        if (levelHeader) levelHeader.style.paddingLeft = "1.2rem";

        // Move NAME column too
        const nameHeader = document.querySelector('.data-column.head-column[column="nickname"]');
        if (nameHeader) nameHeader.style.paddingLeft = "1.2rem";

        decorateRows(starredSet);
        doWhenSelectorAvailable('.league_filter_box', () => createFilterButton(starredSet));

        const observer = new MutationObserver(() => {
            decorateRows(starredSet);

            const mode = GM_getValue(FILTER_MODE_KEY, 'all');
            applyModeFilter(starredSet, mode);
        });

        const target = document.querySelector('.data-list') || document.body;
        observer.observe(target, { childList: true, subtree: true });

        // Let a background stars pull repaint: re-read local (updated by the
        // pull), sync the in-memory set in place, refresh the star icons.
        starReDecorate = () => {
            const latest = new Set(readStarredLocal().starred);
            starredSet.clear();
            latest.forEach(id => starredSet.add(id));
            // repaint existing star toggles
            document.querySelectorAll('.data-row.body-row').forEach(row => {
                const nickSpan = row.querySelector('.data-column[column="nickname"] .nickname[id-member]');
                const el = row.querySelector('.hh-star-toggle');
                if (!nickSpan || !el || row.classList.contains('player-row')) return;
                const id = nickSpan.getAttribute('id-member');
                updateStarVisual(el, starredSet.has(id));
            });
            const mode = GM_getValue(FILTER_MODE_KEY, 'all');
            applyModeFilter(starredSet, mode);
        };
    }

    // ------------ Build Booster Map and InstaBooster Detection ------------
    function buildBoosterExpiryMap(CONFIG) {

        function makeBatchIndex(batch) {
            const byId = new Map();
            const byTime = new Map();

            for (const b of batch) {
                if (b.id != null) byId.set(b.id, b);
                byTime.set(b.lifetime, b);
            }

            return { byId, byTime };
        }

        function boosterExistsInBatch(booster, index) {
            // A booster's identity is its equipped id. Two different boosters
            // (e.g. an old expiring one and a freshly re-equipped one) can share
            // a lifetime but are NOT the same booster. Only fall back to matching
            // by time when the id is missing on this side (legacy/partial data).
            if (booster.id != null) {
                return index.byId.has(booster.id);
            }
            return index.byTime.has(booster.lifetime);
        }

        function isBatchSubset(oldBatch, newIndex) {
            for (const oldBooster of oldBatch) {
                if (!boosterExistsInBatch(oldBooster, newIndex)) {
                    return false;
                }
            }
            return true;
        }

        function batchIdState(batch) {
            let hasNull = false;
            let hasReal = false;

            for (const b of batch) {
                if (b.id == null) hasNull = true;
                else hasReal = true;

                if (hasNull && hasReal) break;
            }

            return { hasNull, hasReal };
        }

        function loadHistory() {
            const stored = readHistoryLocal();
            const currentLeagueKey = server_now_ts + season_end_at;

            if (stored.leagueKey !== currentLeagueKey) {
                // League changed (or first ever). The reset FOLD is handled
                // separately (before this runs) in the main flow; here we just
                // return an empty current-league history to accumulate into.
                GM_setValue(INSTABOOSTER_PLAYER_HISTORY_KEY, []);
                return { leagueKey: currentLeagueKey, history: {} };
            }
            return { leagueKey: currentLeagueKey, history: stored.history || {} };
        }

        function saveHistory(data) {
            writeHistoryLocal(data.leagueKey, data.history);
        }

        function dedupeHistory(history) {
            const cleaned = {};

            for (const playerId in history) {

                const batches = history[playerId];
                const uniqueBatches = [];

                for (const batch of batches) {

                    if (!batch.length) continue;

                    let inserted = false;
                    const idx = makeBatchIndex(batch);

                    for (let i = 0; i < uniqueBatches.length; i++) {

                        const existing = uniqueBatches[i];

                        const same =
                            existing.length === batch.length &&
                            isBatchSubset(existing, idx);

                        if (!same) continue;

                        const { hasNull } = batchIdState(existing);
                        const { hasReal } = batchIdState(batch);

                        if (hasNull && hasReal) {
                            uniqueBatches[i] = batch;
                        }

                        inserted = true;
                        break;
                    }

                    if (!inserted) {
                        uniqueBatches.push(batch);
                    }
                }

                if (uniqueBatches.length) {
                    cleaned[playerId] = uniqueBatches;
                }
            }

            return cleaned;
        }

        function loadAndCleanHistory() {
            const historyData = loadHistory();
            // batches are already object-shaped ({id, lifetime}); just dedupe.
            historyData.history = dedupeHistory(historyData.history || {});
            return historyData;
        }

        function extractBoosters(boosters) {
            if (!Array.isArray(boosters)) return [];

            return boosters
                .filter(b => b && b.lifetime && b.id_member_booster_equipped)
                .map(b => ({
                    id_member_booster_equipped: b.id_member_booster_equipped,
                    lifetime: Number(b.lifetime)
                }))
                .filter(b => Number.isFinite(b.lifetime))
                .sort((a, b) => a.lifetime - b.lifetime);
        }

        function buildBoosterBatches(boosterObjs) {
            const batches = [];
            let batch = [boosterObjs[0]];

            for (let i = 1; i < boosterObjs.length; i++) {
                const b = boosterObjs[i];

                if (b.lifetime - batch[batch.length - 1].lifetime <= BATCH_GAP_THRESHOLD) {
                    batch.push(b);
                } else {
                    batches.push(batch);
                    batch = [b];
                }
            }
            batches.push(batch);

            return batches;
        }

        function detectInstaBoost(batches, playerHistory) {
            if (!playerHistory || !playerHistory.length) return false;

            const now = server_now_ts;
            const expiredBatches = playerHistory
                .filter(batch =>
                    batch.length &&
                    Number.isFinite(batch[batch.length - 1].lifetime) &&
                    batch[batch.length - 1].lifetime <= now
                )
                .slice(-4);

            for (const expiredBatch of expiredBatches) {
                const lastExpiredBatchEnd = expiredBatch[0].lifetime;
                for (const batch of batches) {

                    const batchStart = batch[0].lifetime;
                    if (
                        batchStart - lastExpiredBatchEnd <= 86400 + instaBoosterThreshold &&
                        batchStart - lastExpiredBatchEnd >= 86400
                    ) return true;
                }
            }

            return false;
        }

        function updateBoosterHistory(history, playerId, batches) {
            if (!history[playerId]) history[playerId] = [];

            const storedBatches = history[playerId];
            for (const batch of batches) {
                const newBatch = batch.map(b => ({
                    id: b.id_member_booster_equipped,
                    lifetime: b.lifetime
                }));

                let exists = false;
                const newIndex = makeBatchIndex(newBatch);
                const { hasReal } = batchIdState(newBatch);

                for (let i = storedBatches.length - 1; i >= 0; i--) {
                    const oldBatch = storedBatches[i];
                    const oldIndex = makeBatchIndex(oldBatch);
                    const oldInNew = isBatchSubset(oldBatch, newIndex); // old ⊆ new
                    const newInOld = isBatchSubset(newBatch, oldIndex); // new ⊆ old
                    const sameContent = oldInNew && oldBatch.length === newBatch.length;

                    const { hasNull } = batchIdState(oldBatch);

                    if (sameContent && hasNull && hasReal) {
                        // same batch, new copy has real ids -> replace
                        storedBatches.splice(i, 1);
                        continue;
                    }

                    if (sameContent) {
                        exists = true;
                        break;
                    }

                    // new batch is a partial view of a fuller stored batch:
                    // it's already covered, don't store the partial duplicate.
                    if (newInOld && newBatch.length < oldBatch.length) {
                        exists = true;
                        break;
                    }

                    // old batch is a partial view of the fuller new batch:
                    // drop the partial, the new fuller one will be stored.
                    if (oldInNew) storedBatches.splice(i, 1);
                }

                if (!exists) storedBatches.push(newBatch);
            }
        }

        function finalizeHistory(historyData) {
            const leagueKey = server_now_ts + season_end_at;
            saveHistory({ leagueKey, history: historyData.history });
            // Push happens in the background reconcile (syncHistory), which
            // union-merges and pushes only if the result differs from remote.
        }

        function finalizeInstaPlayers(CONFIG, opponents, instaPlayers, instaBoostedHistory, historyData) {
            const instaSet = new Set(instaPlayers);

            const oldInstaBoosters = instaBoostedHistory.filter(id => !instaSet.has(id));
            window.__oldInstaBoosters = oldInstaBoosters;

            const combined = [...new Set([...oldInstaBoosters, ...instaPlayers])];
            GM_setValue(INSTABOOSTER_PLAYER_HISTORY_KEY, combined);

            let remainingPlayers = [];
            if (CONFIG.addInstaBoosterDetection.addBoosterInfoForAll) {
                remainingPlayers = opponents
                    .map(o => o.player.id_fighter)
                    .filter(id =>
                        !instaSet.has(id) &&
                        !oldInstaBoosters.includes(id)
                    );
            }
            window.__remainingBoosterPlayers = remainingPlayers;
            window.__instaBoosterCache = {
                historyData: historyData.history,
                instaPlayers
            };

            if (instaPlayers.length && CONFIG.addInstaBoosterDetection.enabled) {
                doWhenSelectorAvailable('.data-row.body-row', () => {
                    applyCautionIcons(
                        historyData.history,
                        instaPlayers,
                        remainingPlayers,
                        oldInstaBoosters
                    );
                });
            }
        }

        const opponents = Array.isArray(opponents_list) ? opponents_list : [];

        const historyData = loadAndCleanHistory();

        // ---- Seed archived batches (reappearing flagged players) into the
        //      in-memory display layer so their ⚠️ + PAST LEAGUE tooltip show
        //      from day 1. Tagged fromArchive:true; NEVER saved into live
        //      history (kept out of detection + storage). ----
        seedFromReappears();

        window.boosterExpiries = new Map();

        const instaPlayers = [];
        const instaBoostedHistory = GM_getValue(INSTABOOSTER_PLAYER_HISTORY_KEY, []);

        for (const opp of opponents) {
            const id = opp.player.id_fighter;
            const boosterObjs = extractBoosters(opp.boosters);

            if (!boosterObjs.length) continue;

            const batches = buildBoosterBatches(boosterObjs);
            const playerHistory = historyData.history[id] ?? [];
            const instaFlag = detectInstaBoost(batches, playerHistory);
            window.boosterExpiries.set(id, { boosters: boosterObjs, insta: instaFlag });
            if (instaFlag) instaPlayers.push(id);

            updateBoosterHistory(historyData.history, id, batches);
        }

        finalizeHistory(historyData);
        finalizeInstaPlayers(CONFIG, opponents, instaPlayers, instaBoostedHistory, historyData);

        // local history for this load is now written; unblock the background merge
        if (typeof resolveCollectionDone === 'function') resolveCollectionDone();
    }

    function applyCautionIcons(historyData, instaPlayers, remainingPlayers, oldInstaBoosters) {

        function addCautionIcon(row, playerId, historyData, maxBatches = MAX_DISPLAY_BATCHES, insta = true, oldInsta = false) {
            const liveHistory = historyData[playerId] || [];
            const archivedHistory = (window.__seededArchive && window.__seededArchive[playerId]) || [];

            if (!liveHistory.length && !archivedHistory.length) return;

            const nickCell = row.querySelector('.data-column[column="nickname"]');
            if (!nickCell || nickCell.querySelector('.hh-caution')) return;

            const icon = document.createElement('span');
            icon.className = 'hh-caution';
            icon.textContent = insta || oldInsta ? '⚠️' : 'ℹ️';
            icon.style.marginLeft = '4px';
            icon.style.cursor = 'pointer';

            if (!insta) {
                icon.style.opacity = '0.3';
            }

            let colors;
            if (insta || oldInsta) {
                colors = ['#ff9900', '#ff7300ff', '#ff5f00ff', '#ff5100ff'];
            } else {
                colors = ['#70b8ffff', '#629ff9ff', '#3f81fbff', '#2461fdff'];
            }
            // dimmer palette for the PAST LEAGUE section
            const pastColors = ['#b9741e', '#a8631a', '#985616', '#8a4c13'];

            // ---- LIVE (this league) batches: numbered 1..n, cap to maxBatches.
            //      Live batches are never evicted by the cap; archived fill the
            //      remaining slots. ----
            const liveSlice = liveHistory.slice(-maxBatches);
            const liveTexts = liveSlice.map((batch, index) => {
                const times = batch.map(b => fmt(b.lifetime)).join(', ');
                return `<div style="color:${colors[index % colors.length]}; margin-bottom:4px;">
                    <strong>Batch ${index + 1}:</strong>
                    <span style="color:${colors[index % colors.length]}; padding-left:10px;">${times}</span>
                </div>`;
            });

            // remaining slots for PAST LEAGUE
            const remainingSlots = Math.max(0, maxBatches - liveSlice.length);
            const pastSlice = remainingSlots ? archivedHistory.slice(0, remainingSlots) : [];
            const pastTexts = pastSlice.map((batch, index) => {
                const times = batch.map(b => fmt(b.lifetime)).join(', ');
                return `<div style="color:${pastColors[index % pastColors.length]}; margin-bottom:4px;">
                    <strong>Batch ${index + 1}:</strong>
                    <span style="color:${pastColors[index % pastColors.length]}; padding-left:10px;">${times}</span>
                </div>`;
            });

            const tooltip = document.createElement('div');
            tooltip.className = 'hh-caution-tooltip';

            let header;
            if (insta) {
                header = `<div style="margin-bottom:6px; color:#ff3300ff; font-size: 1rem;">INSTABOOSTER Detected</div>`;
            } else if (oldInsta) {
                header = `<div style="margin-bottom:6px; color:#ff3300ff; font-size: 1rem;">Former INSTABOOSTER</div>`;
            } else {
                header = `<div style="margin-bottom:6px; color:#185affff; font-size: 1rem;">Booster History</div>`;
            }

            let html = header + liveTexts.join('');

            // PAST LEAGUE section only if there's at least one archived batch shown
            if (pastTexts.length) {
                html += `<div style="margin:8px 0 4px; color:#c98a3a; font-size:0.85rem; opacity:0.85; border-top:1px solid rgba(255,255,255,0.15); padding-top:6px;">PAST LEAGUE</div>`;
                html += `<div style="opacity:0.6;">${pastTexts.join('')}</div>`;
            }

            tooltip.innerHTML = html;

            Object.assign(tooltip.style, {
                position: 'absolute',
                background: 'rgba(0,0,0,0.9)',
                padding: '6px 10px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                lineHeight: '1.5',
                maxWidth: '90vw',      // responsive width
                wordWrap: 'break-word',// allow wrapping
                whiteSpace: 'normal',  // allow multiple lines
                zIndex: 9999,
                display: 'none',
                pointerEvents: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            });

            document.body.appendChild(tooltip);

            icon.addEventListener('mouseenter', () => {
                // Temporarily display tooltip to measure size
                tooltip.style.display = 'block';
                tooltip.style.visibility = 'hidden';
                const tooltipWidth = tooltip.offsetWidth;
                const tooltipHeight = tooltip.offsetHeight;
                tooltip.style.visibility = 'visible';
                tooltip.style.display = 'none';

                const rect = icon.getBoundingClientRect();
                let top = rect.bottom + window.scrollY + 6;
                let left = rect.left + window.scrollX + rect.width / 2;

                // Horizontal clamp
                const halfWidth = tooltipWidth / 2;
                left = Math.max(left, window.scrollX + halfWidth + 8);
                left = Math.min(left, window.scrollX + window.innerWidth - halfWidth - 8);

                // Vertical clamp: flip above if not enough space
                if (top + tooltipHeight > window.scrollY + window.innerHeight - 8) {
                    top = rect.top + window.scrollY - tooltipHeight - 6;
                }

                // Clamp top to prevent going off the top
                top = Math.max(top, window.scrollY + 8);

                tooltip.style.top = `${top}px`;
                tooltip.style.left = `${left}px`;
                tooltip.style.transform = 'translateX(-50%)';
                tooltip.style.display = 'block';
            });

            icon.addEventListener('mouseleave', () => {
                tooltip.style.display = 'none';
            });

            // Hide icon on right click
            icon.addEventListener('contextmenu', (e) => {
                icon.style.display = 'none';
                e.preventDefault();
            });

            nickCell.appendChild(icon);
        }

        const seeded = window.__seededArchive || {};

        document.querySelectorAll('.data-row.body-row').forEach(row => {
            const id = Number(
                row.querySelector('.nickname[id-member]')?.getAttribute('id-member')
            );
            if (!id) return;

            const instaSet = new Set(instaPlayers);
            const oldInstaSet = new Set(oldInstaBoosters);
            const remainingSet = new Set(remainingPlayers);

            // A player only in the archive (reappearing flagged player) shows as
            // Former INSTABOOSTER from day 1, even before any live detection.
            const inArchive = !!seeded[id] && seeded[id].length;

            if (instaSet.has(id)) {
                addCautionIcon(row, id, historyData, MAX_DISPLAY_BATCHES, true, false);
            }
            else if (oldInstaSet.has(id) || inArchive) {
                addCautionIcon(row, id, historyData, MAX_DISPLAY_BATCHES, false, true);
            }
            else if (remainingSet.has(id)) {
                addCautionIcon(row, id, historyData, MAX_DISPLAY_BATCHES, false, false);
            }
        });
    }

    // ------------ Local Booster Expiration timer ------------
    function localBoosterExpirationInit() {
        const decodeHTML = (html) => {
            const t = document.createElement('textarea');
            t.innerHTML = html;
            return t.value;
        };

        const safeParse = (raw) => {
            if (!raw) return null;
            try {
                let d = decodeHTML(raw);
                if (d.includes('&quot;')) d = decodeHTML(d);
                return JSON.parse(d);
            } catch {
                return null;
            }
        };

        function replaceItemPrice(tooltip, timeText) {
            const priceEl = tooltip.querySelector('.item-price');
            if (!priceEl) return false;

            priceEl.innerHTML = '';
            priceEl.style.textAlign = 'center';
            priceEl.style.fontSize = '12px';
            priceEl.style.color = '#ffbf00ff';
            priceEl.style.textShadow = '1px 1px 2px #000';
            priceEl.textContent = `Ends at ${timeText}`;
            return true;
        }

        // --------------------------
        // Hover event (local expiry)
        // --------------------------
        document.body.addEventListener(
            'mouseenter',
            (ev) => {
                const slot = ev.target.closest('.boosters .slot[booster-item-tooltip]');
                if (!slot) return;

                const data = safeParse(slot.getAttribute('data-d'));
                if (!data || !data.id_member || !data.id_member_booster_equipped) return;

                const ownerId = data.id_member;
                const boosterId = data.id_member_booster_equipped;

                const ownerData = window.boosterExpiries?.get(ownerId);
                if (!ownerData || !ownerData.boosters || !ownerData.boosters.length) return;

                const matchingBooster = ownerData.boosters.find(b => b.id_member_booster_equipped === boosterId);
                if (!matchingBooster) return;

                const localTime = fmt(matchingBooster.lifetime);

                doWhenSelectorAvailable('.hh_tooltip_new.item_tooltip', () => {
                    const tooltip = document.querySelector('.hh_tooltip_new.item_tooltip');
                    replaceItemPrice(tooltip, localTime);
                });
            },
            true
        );
    }

    // ------------ Sort By Booster Expiration ------------
    function sortByBoosterExpirationInit() {
        // 1) Perf CSS: make long lists scroll smoothly even with flex
        const style = document.createElement('style');
        style.textContent = `
            .data-list { will-change: contents; }
            .data-list .data-row.body-row {
                content-visibility: auto;
                contain-intrinsic-size: 64px;
                backface-visibility: hidden;
            }
        `;
        document.documentElement.appendChild(style);

        // Extract earliest expiration from window.boosterExpiries
        const getExpiration = (row) => {
            if (row.dataset.expTs) return +row.dataset.expTs;

            try {
                // Find all booster slots in this row
                const boosters = row.querySelectorAll('.boosters .slot[data-d]');
                if (!boosters.length) { row.dataset.expTs = '0'; return 0; }

                // Find owner id from the first slot
                const firstSlotData = JSON.parse(boosters[0].dataset.d);
                const ownerId = firstSlotData.id_member;
                if (!ownerId) { row.dataset.expTs = '0'; return 0; }

                const boosterData = window.boosterExpiries.get(ownerId);
                const boosterObjs = boosterData?.boosters || [];
                if (!boosterObjs.length) { row.dataset.expTs = '0'; return 0; }

                // Take the earliest booster lifetime
                const minTs = Math.min(...boosterObjs.map(b => b.lifetime || Infinity));

                row.dataset.expTs = String(minTs || 0);
                return minTs || 0;
            } catch {
                row.dataset.expTs = '0';
                return 0;
            }
        };

        // Apply flex visual order (keep flex ON to preserve sorted view)
        const applyVisualOrder = (desc) => {
            const rows = [...document.querySelectorAll('.data-list .data-row.body-row')];
            if (!rows.length) return;

            const parent = rows[0].parentElement;
            parent.style.display = 'flex';
            parent.style.flexDirection = 'column';

            // Compute once, batch DOM writes
            const computed = rows.map(r => ({ r, exp: getExpiration(r) }));
            computed.sort((a, b) => (desc ? b.exp - a.exp : a.exp - b.exp));

            requestAnimationFrame(() => {
                computed.forEach(({ r }, idx) => {
                    r.style.order = idx;
                });
            });
        };

        // Hook up the header click (two-state toggle)
        let icon;
        const enableSorting = () => {
            const header = document.querySelector('.head-column[column="boosters"]');
            if (!header || header.dataset.sortReady) return;
            header.dataset.sortReady = '1';
            header.style.cursor = 'pointer';

            const span = header.querySelector('span') || header.appendChild(document.createElement('span'));
            icon = span.querySelector('.upArrow_mix_icn, .downArrow_mix_icn, .upDownArrows_mix_icn');
            if (!icon) {
                icon = document.createElement('span');
                icon.className = 'upDownArrows_mix_icn';
                span.appendChild(icon);
            }

            let desc;
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                // Refresh cached expirations once per click (in case boosters updated)
                document.querySelectorAll('.data-list .data-row.body-row').forEach(r => delete r.dataset.expTs);

                const saved = GM_getValue(SORT_KEY, {});
                desc = saved["column"] === 'boosters'
                    ? saved["direction"] === 'DESC'
                    : true;

                desc = !desc;
                applyVisualOrder(desc);
                icon.className = desc ? 'downArrow_mix_icn' : 'upArrow_mix_icn';

                // SAVE STATE
                GM_setValue(SORT_KEY, {
                    column: 'boosters',
                    direction: desc ? 'DESC' : 'ASC'
                });
            });
        };

        const header = document.querySelector('.head-column[column="boosters"]');
        doWhenSelectorAvailable('.data-list .data-row.body-row', () => {
            const firstRow = document.querySelector('.data-list .data-row.body-row');
            if (header && firstRow) {
                enableSorting();
            }
        });

        // Restore boosters sorting on load
        const saved = GM_getValue(SORT_KEY, {});
        if (saved["column"] === 'boosters') {
            requestAnimationFrame(() => {
                applyVisualOrder(saved["direction"] === 'DESC');
                icon.className = saved["direction"] === 'DESC'
                    ? 'downArrow_mix_icn'
                    : 'upArrow_mix_icn';
            });
        }
    }

    function SortPersistenceInit() {
        const headerRow = document.querySelector('.data-row.head-row');
        if (!headerRow) return;

        headerRow.addEventListener('click', (e) => {
            const header = e.target.closest('.head-column');
            if (!header) return;

            const column = header.getAttribute('column');
            if (!column) return;

            const direction = header.getAttribute('sorting');
            if (!direction) return;

            if (column !== 'boosters') {
                // SAVE STATE
                GM_setValue(SORT_KEY, {
                    column: column,
                    direction: direction === 'DESC' ? 'DESC' : 'ASC'
                });
            }
        });
    }

    // ------------ Disable 3x button ------------
    function disableMultiBattleButtonObserver() {

        function updateBtnStyle(btn) {
            if (multiBattleArmed) {
                btn.style.opacity = '1';
                btn.title = 'Click again to start MultiBattle';
            } else {
                btn.style.opacity = '0.5';
                btn.title = 'Click once to enable MultiBattle';
            }
        }

        function disableMultiBattleButton() {
            doWhenSelectorAvailable('.league-multiple-battle-button', () => {
                const btn = document.querySelector('.league-multiple-battle-button');
                if (!btn) return;
                if (btn.getAttribute('disabled') === 'disabled') return;

                // Avoid attaching multiple listeners
                if (!btn.dataset.twoStepAttached) {
                    btn.dataset.twoStepAttached = 'true';

                    btn.addEventListener('click', (e) => {
                        if (!multiBattleArmed) {
                            // First click → arm
                            e.stopImmediatePropagation();
                            e.preventDefault();
                            multiBattleArmed = true;
                            updateBtnStyle(btn);

                            // Auto disarm after 3s
                            setTimeout(() => {
                                multiBattleArmed = false;
                                updateBtnStyle(btn);
                            }, 3000);

                        } else {
                            // Second click → let the game handle normally
                            multiBattleArmed = false;
                        }
                    }, true);
                }

                // Always apply correct style based on current state
                updateBtnStyle(btn);
            });
        }

        const target = document.querySelector('.player_team_block.opponent');
        if (!target) return;

        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (m.type === 'childList' || m.type === 'attributes') {
                    disableMultiBattleButton();
                    break;
                }
            }
        });

        observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        // Run once immediately
        disableMultiBattleButton();
    }

    function colorMatchScoresInit() {

        function colorMatchScores() {
            document.querySelectorAll('.data-column[column="match_history_sorting"] .result').forEach(el => {
                const score = parseInt(el.textContent.trim(), 10);
                if (isNaN(score)) return;

                if (score === 25) {
                    el.classList.add('won');
                    el.classList.remove('lost');
                } else {
                    el.classList.add('lost');
                    el.classList.remove('won');
                }
            });
        }

        colorMatchScores();

        doWhenSelectorAvailable('.data-list', () => {
            const observer = new MutationObserver(colorMatchScores);
            observer.observe(document.querySelector('.data-list'), {
                childList: true,
                subtree: true
            });
        });
    }

    // ------------ Main Execution ------------
    async function loadConfig() {
        // defaults
        let config = {
            starLeague:
                { enabled: true },
            localBoosterExpiration:
                { enabled: true },
            sortByBoosterExpiration:
                { enabled: true },
            addInstaBoosterDetection:
                { enabled: true, addBoosterInfoForAll: true },
            disableMultiBattleButton:
                { enabled: true },
            changeScoreColors:
                { enabled: false },
            githubSync:
                { enabled: true },
        };

        // changing config requires HH++
        const {
            loadConfig: hhLoadConfig, registerGroup, registerModule, runModules,
        } = hhPlusPlusConfig;

        registerGroup({
            key: 'SeveralLeagues',
            name: 'Several Leagues'
        });

        const sheet = document.createElement('style');
        sheet.textContent = `
            h4.SeveralLeagues.selected::after {
                content: 'v${GM_info.script.version}';
                display: block;
                position: absolute;
                top: -10px;
                right: -15px;
                font-size: 10px;
            }
            h4.SeveralLeagues.selected:last-child::after { right: 0; }
        `;
        document.head.appendChild(sheet);

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'starLeague',
                label: `STAR players and filter
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- Stars are persistent accross leagues</div>
                            <div>- Filter is added to HH++ league filter</div>
                            <div>- Synced to GitHub if League Tracker config is present</div>
                        </div>
                        `,
                default: true,
            },
            run() {
                config.starLeague = {
                    enabled: true,
                };
            },
        });
        config.starLeague.enabled = false;

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'localBoosterExpiration',
                label: `Local Booster Expiration Timer
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- Shows local time for booster expiration in tooltip</div>
                            <div>- Hover over booster icon to see local expiration time</div>
                        </div>
                        `,
                default: true,
            },
            run() {
                config.localBoosterExpiration = {
                    enabled: true,
                };
            },
        });
        config.localBoosterExpiration.enabled = false;

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'addInstaBoosterDetection',
                label: `Instabooster detection <br>
                        <div style="margin:10px 0px;display:flex;align-items:center;gap:4px;">
                            <label style="width:70px">Threshold:</label>
                            <input type="text" id="insta-booster-threshold" style="text-align:center;height:1rem;width:2.5rem">
                            <span>s</span>
                        </div>
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- ⚠️ icon beside player names.</div>
                            <div>- Hover over icon to see recent booster history.</div>
                            <div>- Stays flagged even if they stop insta boosting (Slightly Transparent).</div>
                            <div>- Reappearing flagged players show PAST LEAGUE history from day 1 (if syncing).</div>
                            <div>- Resets everything on League reset.</div>
                            <div>- Right click icon to hide it.</div>
                        </div>`,
                default: true,
                subSettings: [
                    {
                        key: 'addBoosterInfoForAll', default: false,
                        label: 'Add ℹ️ icon for others',
                    },
                ],
            },
            run(subSettings) {
                config.addInstaBoosterDetection = {
                    enabled: true,
                    addBoosterInfoForAll: subSettings.addBoosterInfoForAll,
                };
            },
        });
        config.addInstaBoosterDetection.enabled = false;

        doWhenSelectorAvailable('#insta-booster-threshold', () => {
            const input = document.querySelector('#insta-booster-threshold');
            let threshold = GM_getValue(INSTABOOSTER_KEY, INSTABOOSTER_THRESHOLD_DEFAULT);
            input.value = threshold.toString();
            input.addEventListener('focusout', () => {
                const inputValue = parseFloat(input.value);
                const newThreshold = isNaN(inputValue) ? INSTABOOSTER_THRESHOLD_DEFAULT : Math.min(3000, Math.max(0, inputValue));
                if (newThreshold !== threshold) {
                    // mark settings changed so the next load reconcile pushes it
                    GM_setValue(SETTINGS_AT_KEY, Date.now());
                }
                threshold = newThreshold;
                GM_setValue(INSTABOOSTER_KEY, threshold);
                instaBoosterThreshold = threshold;
                input.value = threshold.toString();
            });
        });

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'sortByBoosterExpiration',
                label: `Sort by Booster Expiration
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- Click on the "Stats and Boosters" column header to sort by booster expiration time.</div>
                        </div>`,
                default: true,
            },
            run() {
                config.sortByBoosterExpiration = {
                    enabled: true,
                };
            }
        });
        config.sortByBoosterExpiration.enabled = false;

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'disableMultiBattleButton',
                label: `2 Click MultiBattle Button
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- Prevent accidental MultiBattle by requiring two clicks.</div>
                            <div>- First click arms/unlocks the button, second click initiates the battle.</div>
                            <div>- Auto disarms/locks after 3 seconds.</div>
                        </div>`,
                default: true,
            },
            run() {
                config.disableMultiBattleButton = {
                    enabled: true,
                };
            }
        });
        config.disableMultiBattleButton.enabled = false;

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'changeScoreColors',
                label: `Mark lost points in red
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- 25 points = Green.</div>
                            <div>- Otherwise, red.</div>
                        </div>`,
                default: false,
            },
            run() {
                config.changeScoreColors = {
                    enabled: true,
                };
            }
        });
        config.changeScoreColors.enabled = false;

        registerModule({
            group: 'SeveralLeagues',
            configSchema: {
                baseKey: 'githubSync',
                label: `Sync to GitHub
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- Syncs stars, booster history &amp; threshold across devices.</div>
                            <div>- Reuses the HH League Tracker's GitHub config. Local if absent.</div>
                        </div>`,
                default: false,
            },
            run() {
                config.githubSync = {
                    enabled: true,
                };
            }
        });
        config.githubSync.enabled = false;

        hhLoadConfig();
        runModules();

        // apply the toggle to the sync layer's master switch
        gitHubSync.state.toggleOn = !!config.githubSync.enabled;

        return config;
    }

    const {
        HHPlusPlus: {
            Helpers: {
                doWhenSelectorAvailable,
            },
        },
        hhPlusPlusConfig,
    } = unsafeWindow;

    const config = await loadConfig();

    if (window.location.pathname.includes('home.html')) {
        return;
    }

    // ==================================================================
    // ===== Sync: render from local first, reconcile in background =====
    // ==================================================================
    // The UI renders immediately from local GM storage (as fast as the old
    // script). All GitHub traffic happens in a background task that patches
    // the UI if newer data arrives. Everything reconciles on load — there are
    // no action-triggered pushes.
    //
    // One ordering constraint survives: at a league reset, last league's
    // flagged players must be captured BEFORE buildBoosterExpiryMap runs (it
    // clears the flagged-id list and wipes history). So we snapshot that data
    // synchronously here, then the background task folds it into the archive.

    const currentLeagueKey = server_now_ts + season_end_at;

    // Resolves once buildBoosterExpiryMap has written this load's observations
    // to local history, so the background history merge runs on top of them
    // (avoids a read-read-write race that could drop either side's batches).
    let resolveCollectionDone;
    const collectionDone = new Promise(res => { resolveCollectionDone = res; });
    const collectionWillRun = config.addInstaBoosterDetection.enabled
        || config.localBoosterExpiration.enabled
        || gitHubSync.isEnabled();
    if (!collectionWillRun) resolveCollectionDone();

    // Re-render hook: lets a background history merge repaint caution icons.
    function onHistoryChanged() {
        if (!config.addInstaBoosterDetection.enabled) return;
        if (!window.__instaBoosterCache) return;
        const cache = window.__instaBoosterCache;
        // refresh the in-memory history reference to the freshly merged copy
        const fresh = readHistoryLocal();
        if (fresh.leagueKey === currentLeagueKey) cache.historyData = fresh.history;
        applyCautionIcons(
            cache.historyData, cache.instaPlayers,
            window.__remainingBoosterPlayers, window.__oldInstaBoosters
        );
    }

    // ---- Synchronous reset capture (no network) ----
    (function captureResetSnapshot() {
        const stored = readHistoryLocal();
        window.__slReset = { isReset: stored.leagueKey !== currentLeagueKey, outgoingFlagged: {}, roster: [] };
        if (!window.__slReset.isReset) return;

        const flaggedIds = new Set(
            (GM_getValue(INSTABOOSTER_PLAYER_HISTORY_KEY, []) || []).map(String)
        );
        const outgoingHistory = (stored.history && typeof stored.history === 'object') ? stored.history : {};
        for (const id in outgoingHistory) {
            if (flaggedIds.has(String(id))) {
                const batches = (outgoingHistory[id] || []).map(coerceBatch).filter(b => b.length);
                if (batches.length) window.__slReset.outgoingFlagged[id] = batches;
            }
        }
        window.__slReset.roster = (Array.isArray(opponents_list) ? opponents_list : [])
            .map(o => o.player.id_fighter);
    })();

    // ---- Background reconcile (fire-and-forget; never blocks rendering) ----
    async function syncBackground() {
        if (!gitHubSync.isEnabled()) return;

        // reset fold FIRST (builds the reappears snapshot other loads seed from).
        if (window.__slReset && window.__slReset.isReset) {
            try {
                await gitHubSync.withTimeout(
                    foldAndBuildReappears(currentLeagueKey, window.__slReset.outgoingFlagged, window.__slReset.roster),
                    10000
                );
                // snapshot for THIS league now exists — seed + repaint so the
                // day-1 PAST LEAGUE flags appear on this reset load, not next.
                seedFromReappears();
                if (config.addInstaBoosterDetection.enabled && window.__instaBoosterCache) {
                    const c = window.__instaBoosterCache;
                    applyCautionIcons(c.historyData, c.instaPlayers,
                        window.__remainingBoosterPlayers, window.__oldInstaBoosters);
                }
            } catch (e) { console.warn('Several Leagues: fold/reappears failed', e); }
        }

        // stars, settings, history run concurrently (independent files).
        const starsP = gitHubSync.withTimeout(syncStars(), 8000)
            .then(changed => { if (changed && starReDecorate) starReDecorate(); })
            .catch(e => console.warn('Several Leagues: stars sync failed', e));

        const settingsP = gitHubSync.withTimeout(syncSettings(), 8000)
            .catch(e => console.warn('Several Leagues: settings sync failed', e));

        // history merge waits until this load's observations are written locally,
        // so the union-merge runs on top of them (with a safety cap so it can't
        // hang if collection never signals).
        const historyP = Promise.race([
            collectionDone,
            new Promise(res => setTimeout(res, 6000)),
        ]).then(() => gitHubSync.withTimeout(syncHistory(currentLeagueKey), 8000))
          .catch(e => console.warn('Several Leagues: history sync failed', e));

        await Promise.allSettled([starsP, settingsP, historyP]);
    }

    // hook the star-list re-decorator (set by starInit so background pulls repaint)
    let starReDecorate = null;

    if (config.starLeague.enabled) {
        doWhenSelectorAvailable('.data-column.head-column[column="level"]', starInit);
    }

    if (config.addInstaBoosterDetection.enabled || config.localBoosterExpiration.enabled || gitHubSync.isEnabled()) {
        // Collection runs if display OR local-timer OR sync is on, so a device
        // with detection off still records + syncs booster history.
        doWhenSelectorAvailable('.data-list .data-row.body-row', () => buildBoosterExpiryMap(config));
    }

    if (config.localBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.data-list .data-row.body-row', localBoosterExpirationInit);
    }

    if (config.sortByBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.data-row.head-row', SortPersistenceInit);
        doWhenSelectorAvailable('.head-column[column="boosters"]', () => sortByBoosterExpirationInit());
    }

    if (config.changeScoreColors.enabled) {
        colorMatchScoresInit();
    }

    // Global variable for armed state
    let multiBattleArmed = false;
    if (config.disableMultiBattleButton.enabled) {
        const rootObserver = new MutationObserver(() => {
            const block = document.querySelector('.player_team_block.opponent');
            if (block && !block.dataset.observed) {
                block.dataset.observed = 'true';
                disableMultiBattleButtonObserver();
            }
        });
        rootObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    const cautionObserver = new MutationObserver(() => {
        if (!window.__instaBoosterCache) return;
        if (!config.addInstaBoosterDetection.enabled) return;
        const { historyData, instaPlayers } = window.__instaBoosterCache;
        applyCautionIcons(historyData, instaPlayers, window.__remainingBoosterPlayers, window.__oldInstaBoosters);
    });

    doWhenSelectorAvailable('.data-list', () => {
        const list = document.querySelector('.data-list');
        cautionObserver.observe(list, {
            childList: true,
            subtree: true
        });
    });

    syncBackground();
}

waitForHHPlusPlus(() => {
    severalLeagues();
});