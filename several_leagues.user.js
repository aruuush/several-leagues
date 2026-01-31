// ==UserScript==
// @name         Several Leagues
// @namespace    hh-several-leagues
// @version      4.2.10
// @author       arush
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

    const INSTABOOSTER_THRESHOLD_DEFAULT = 10; // seconds
    const BATCH_GAP_THRESHOLD = 10; // seconds
    let instaBoosterThreshold = GM_getValue(INSTABOOSTER_KEY, INSTABOOSTER_THRESHOLD_DEFAULT);

    // ------------ Utility ------------
    const fmt = (ts) =>
        new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // ------------ Star League Players ------------
    function starInit() {
        function loadStarred() {
            try {
                const raw = GM_getValue(STARRED_KEY, []);
                return new Set(raw);
            } catch (e) {
                console.error('Several Leagues: Failed to load starred players', e);
                return new Set();
            }
        }

        function saveStarred(set) {
            try {
                GM_setValue(STARRED_KEY, [...set]);
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
    }

    // ------------ Build Booster Map and InstaBooster Detection ------------
    function buildBoosterExpiryMap(CONFIG) {

        function dedupeHistory(history) {
            /* Deduplicate booster history data to save space */

            const cleaned = {};

            for (const playerId in history) {

                const batches = history[playerId];
                const uniqueBatches = [];

                for (const batch of batches) {

                    // ---- Remove empty batches ----
                    if (!batch.length) continue;

                    // ---- Deduplicate entire batches ----
                    let inserted = false;

                    for (let i = 0; i < uniqueBatches.length; i++) {

                        const existing = uniqueBatches[i];

                        const same =
                            existing.length === batch.length &&
                            isBatchSubset(existing, batch);

                        if (!same) continue;

                        // Upgrade null-id batch
                        if (batchHasNullIds(existing) && batchHasRealIds(batch)) {
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

        function normalizeHistory(history) {
            /* For backwords compatibility, we support two formats in the history:
        
            OLD FORMAT: {
                playerId: [
                    [lifetime1, lifetime2, ...],  // batch 1
                    [lifetime1, lifetime2, ...],  // batch 2
                    ...
                ]
            }
            NEW FORMAT: {
                playerId: [
                    [ { id: boosterId, lifetime: number }, ... ],  // batch 1
                    [ { id: boosterId, lifetime: number }, ... ],  // batch 2
                    ...
                ]
            }
            */
            const normalized = {};

            for (const playerId in history) {
                normalized[playerId] = history[playerId].map(batch => {

                    // OLD FORMAT
                    if (typeof batch[0] === 'number') {
                        return batch.map(lifetime => ({
                            id: null,          // unknown for old data
                            lifetime
                        }));
                    }

                    // NEW FORMAT already
                    return batch.map(b => ({
                        id: b.id ?? null,
                        lifetime: Number(b.lifetime)
                    }));
                });
            }

            return normalized;
        }

        function loadHistory() {
            const data = GM_getValue(HISTORY_KEY, {});
            const currentLeagueKey = server_now_ts + season_end_at;
            if (!data) return { leagueKey: currentLeagueKey, history: {} };
            try {
                if (data.leagueKey !== currentLeagueKey) {
                    GM_setValue(INSTABOOSTER_PLAYER_HISTORY_KEY, []);
                    return { leagueKey: currentLeagueKey, history: {} };
                }
                return data;
            } catch {
                GM_setValue(INSTABOOSTER_PLAYER_HISTORY_KEY, []);
                return { leagueKey: currentLeagueKey, history: {} };
            }
        }

        function saveHistory(data) {
            GM_setValue(HISTORY_KEY, data);
        }

        function makeBatchIndex(batch) {
            const byId = new Map();
            const byTime = new Map();

            for (const b of batch) {
                if (b.id != null) byId.set(b.id, b);
                byTime.set(b.lifetime, b);
            }

            return { byId, byTime };
        }

        function boosterExistsInBatch(booster, batchIndex) {

            // Prefer ID match
            if (booster.id != null && batchIndex.byId.has(booster.id)) {
                return true;
            }

            // Fallback to lifetime match (old data compatibility)
            if (batchIndex.byTime.has(booster.lifetime)) {
                return true;
            }

            return false;
        }

        function isBatchSubset(oldBatch, newBatch) {

            const newIndex = makeBatchIndex(newBatch);

            for (const oldBooster of oldBatch) {
                if (!boosterExistsInBatch(oldBooster, newIndex)) {
                    return false;
                }
            }

            return true;
        }

        function batchHasNullIds(batch) {
            return batch.some(b => b.id == null);
        }

        function batchHasRealIds(batch) {
            return batch.some(b => b.id != null);
        }

        const l = opponents_list;
        if (!Array.isArray(l)) return;

        // Load and normalize history in case data is in old format
        const historyData = loadHistory();
        historyData.history = dedupeHistory(
            normalizeHistory(historyData.history || {})
        );

        window.boosterExpiries = new Map();
        const instaPlayers = [];
        const instaBoostedHistory = GM_getValue(INSTABOOSTER_PLAYER_HISTORY_KEY, []);

        for (let i = 0; i < l.length; i++) {
            const opp = l[i];
            const id = opp.player.id_fighter;
            const boosters = opp.boosters || [];
            if (!boosters.length) continue;

            // Prepare current boosters
            const boosterObjs = boosters
                .filter(b => b && b.lifetime && b.id_member_booster_equipped)
                .map(b => ({
                    id_member_booster_equipped: b.id_member_booster_equipped,
                    lifetime: Number(b.lifetime)
                }))
                .filter(b => Number.isFinite(b.lifetime))
                .sort((a, b) => a.lifetime - b.lifetime);

            if (!boosterObjs.length) continue;

            // Group current boosters into batches (<=10s difference)
            const batches = [];
            let currentBatch = [];
            for (let j = 0; j < boosterObjs.length; j++) {
                const b = boosterObjs[j];
                if (!currentBatch.length || b.lifetime - currentBatch[currentBatch.length - 1].lifetime <= BATCH_GAP_THRESHOLD) {
                    currentBatch.push(b);
                } else {
                    batches.push(currentBatch);
                    currentBatch = [b];
                }
            }
            if (currentBatch.length) batches.push(currentBatch);

            // Get last 4 historical batches (expired only)
            const playerHistory = historyData.history[id] || [];

            // Take last 4 expired batches from history
            const now = server_now_ts;
            const expiredBatches = playerHistory
                .filter(batch =>
                    batch.length &&
                    Number.isFinite(batch[batch.length - 1].lifetime) &&
                    batch[batch.length - 1].lifetime <= now
                )
                .slice(-4);

            let instaFlag = false;
            if (expiredBatches.length) {
                for (const expiredBatch of expiredBatches) {
                    const lastExpiredBatchEnd = expiredBatch[0].lifetime; // earliest in the expired batch
                    for (const batch of batches) {
                        const batchStart = batch[0].lifetime;
                        if (batchStart - lastExpiredBatchEnd <= 86400 + instaBoosterThreshold && batchStart - lastExpiredBatchEnd >= 86400) {
                            instaFlag = true;
                            break; // insta detected, no need to check further
                        }
                    }
                    if (instaFlag) break;
                }
            }

            // Save boosters + insta flag
            window.boosterExpiries.set(id, { boosters: boosterObjs, insta: instaFlag });
            if (instaFlag) instaPlayers.push(id);

            // Update history with current batches (partial-batch safe)
            if (!historyData.history[id]) historyData.history[id] = [];

            const storedBatches = historyData.history[id];

            batches.forEach(batch => {

                const newBatch = batch.map(b => ({
                    id: b.id_member_booster_equipped,
                    lifetime: b.lifetime
                }));

                let exists = false;

                for (let i = storedBatches.length - 1; i >= 0; i--) {

                    const oldBatch = storedBatches[i];

                    const sameContent =
                        oldBatch.length === newBatch.length &&
                        isBatchSubset(oldBatch, newBatch);

                    const partialContent =
                        oldBatch.length < newBatch.length &&
                        isBatchSubset(oldBatch, newBatch);

                    // ---- 1) Upgrade null-id batch ----
                    if (sameContent && batchHasNullIds(oldBatch) && batchHasRealIds(newBatch)) {
                        storedBatches.splice(i, 1);
                        continue;
                    }

                    // ---- 2) True duplicate ----
                    if (sameContent) {
                        exists = true;
                        break;
                    }

                    // ---- 3) Remove partial snapshot ----
                    if (partialContent) {
                        storedBatches.splice(i, 1);
                    }
                }

                if (!exists) {
                    storedBatches.push(newBatch);
                }

            });
        }

        const leagueKey = server_now_ts + season_end_at;

        // Save history back to GM storage
        saveHistory({ leagueKey: leagueKey, history: historyData.history });

        window.__instaBoosterCache = {
            historyData: historyData.history,
            instaPlayers
        };

        // Remove players from current insta boosted list if they no longer insta boost
        const oldInstaBoosters = instaBoostedHistory.filter(id => !instaPlayers.includes(id));
        window.__oldInstaBoosters = oldInstaBoosters;

        // Add new insta boosters to history
        const combinedInstaBoosters = [...new Set(oldInstaBoosters.concat(instaPlayers))];
        GM_setValue(INSTABOOSTER_PLAYER_HISTORY_KEY, combinedInstaBoosters);

        let remainingPlayers = [];
        if (CONFIG.addInstaBoosterDetection.addBoosterInfoForAll) {
            remainingPlayers = l
                .map(opp => opp.player.id_fighter)
                .filter(id => !instaPlayers.includes(id) && !oldInstaBoosters.includes(id));
        }

        window.__remainingBoosterPlayers = remainingPlayers;

        // Place ⚠️ icon beside player names
        if (instaPlayers.length && CONFIG.addInstaBoosterDetection.enabled) {
            doWhenSelectorAvailable('.data-row.body-row', () => {
                applyCautionIcons(historyData.history, instaPlayers, remainingPlayers, oldInstaBoosters);
            });
        }
    }

    function applyCautionIcons(historyData, instaPlayers, remainingPlayers, oldInstaBoosters) {

        function addCautionIcon(row, playerId, historyData, maxBatches = 8, insta = true, oldInsta = false) {
            const playerHistory = historyData[playerId];
            if (!playerHistory || !playerHistory.length) return;

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

            const lastBatches = playerHistory.slice(-maxBatches);
            const batchTexts = lastBatches.map((batch, index) => {
                const times = batch.map(b => fmt(b.lifetime)).join(', ');
                return `<div style="color:${colors[index % colors.length]}; margin-bottom:4px;">
                    <strong>Batch ${index + 1}:</strong>
                    <span style="color:${colors[index % colors.length]}; padding-left:10px;">${times}</span>
                </div>`;
            });

            const tooltip = document.createElement('div');
            tooltip.className = 'hh-caution-tooltip';
            if (insta) {
                tooltip.innerHTML = `<div style="margin-bottom:6px; color:#ff3300ff; font-size: 1rem;">INSTABOOSTER Detected</div>${batchTexts.join('')}`;
            } else if (oldInsta) {
                tooltip.innerHTML = `<div style="margin-bottom:6px; color:#ff3300ff; font-size: 1rem;">Former INSTABOOSTER</div>${batchTexts.join('')}`;
            } else {
                tooltip.innerHTML = `<div style="margin-bottom:6px; color:#185affff; font-size: 1rem;">Booster History</div>${batchTexts.join('')}`;
            }
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

        document.querySelectorAll('.data-row.body-row').forEach(row => {
            const id = Number(
                row.querySelector('.nickname[id-member]')?.getAttribute('id-member')
            );
            if (!id) return;

            if (instaPlayers.includes(id)) {
                addCautionIcon(row, id, historyData, 8, true, false);
            }
            else if (oldInstaBoosters.includes(id)) {
                addCautionIcon(row, id, historyData, 8, false, true);
            }
            else if (remainingPlayers.includes(id)) {
                addCautionIcon(row, id, historyData, 8, false, false);
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

    // ------------ Sort Persistence ------------

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
                label: `INSTABOOSTER detection <br>
                        <div style="margin:10px 0px;display:flex;align-items:center;gap:4px;">
                            <label style="width:70px">Threshold:</label>
                            <input type="text" id="insta-booster-threshold" style="text-align:center;height:1rem;width:2.5rem">
                            <span>s</span>
                        </div>
                        <div style="margin-top:10px; display:flex;flex-direction:column;gap:4px;color:#999DA0;">
                            <div>- ⚠️ icon beside player names.</div>
                            <div>- Hover over icon to see recent booster history.</div>
                            <div>- Stays flagged even if they stop insta boosting (Slightly Transparent).</div>
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
                threshold = isNaN(inputValue) ? INSTABOOSTER_THRESHOLD_DEFAULT : Math.min(3000, Math.max(0, inputValue));
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

        hhLoadConfig();
        runModules();

        return config;
    }

    // Transfer localStorage to GM storage (one-time)
    try {
        const STARRED_VALS = localStorage.getItem(STARRED_KEY);
        if (STARRED_VALS !== null && STARRED_VALS !== undefined) {
            GM_setValue(STARRED_KEY, JSON.parse(STARRED_VALS));
            localStorage.removeItem(STARRED_KEY);
        }
        const FILTER_MODE_VAL = localStorage.getItem(FILTER_MODE_KEY);
        if (FILTER_MODE_VAL !== null && FILTER_MODE_VAL !== undefined) {
            GM_setValue(FILTER_MODE_KEY, FILTER_MODE_VAL);
            localStorage.removeItem(FILTER_MODE_KEY);
        }
        const SORT_STATE_VAL = localStorage.getItem(SORT_KEY);
        if (SORT_STATE_VAL !== null && SORT_STATE_VAL !== undefined) {
            GM_setValue(SORT_KEY, JSON.parse(SORT_STATE_VAL));
            localStorage.removeItem(SORT_KEY);
        }
        const BOOSTER_HISTORY_VAL = localStorage.getItem('boosterHistory');
        if (BOOSTER_HISTORY_VAL !== null && BOOSTER_HISTORY_VAL !== undefined) {
            GM_setValue('boosterHistory', BOOSTER_HISTORY_VAL);
            localStorage.removeItem('boosterHistory');
        }
    } catch (e) {
        console.error('Several Leagues: Failed to transfer data from localStorage to GM storage', e);
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

    if (config.starLeague.enabled) {
        doWhenSelectorAvailable('.data-column.head-column[column="level"]', starInit);
    }

    if (config.addInstaBoosterDetection.enabled || config.localBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.data-list .data-row.body-row', () => buildBoosterExpiryMap(config));
    }

    if (config.localBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.data-list .data-row.body-row', localBoosterExpirationInit);
    }

    if (config.sortByBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.data-row.head-row', SortPersistenceInit);
        doWhenSelectorAvailable('.head-column[column="boosters"]', () => sortByBoosterExpirationInit());
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
}

waitForHHPlusPlus(() => {
    severalLeagues();
});