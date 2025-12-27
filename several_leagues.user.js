// ==UserScript==
// @name         Several Leagues
// @namespace    hh-several-leagues
// @version      4.0.3
// @author       arush
// @description  Several League enhancements: star players, filter by star, local booster expiration time, sort by booster expiration, disable accidental 3x battle clicks, sort persistence
// @match        *://*.hentaiheroes.com/*leagues.html*
// @match        *://*.haremheroes.com/*leagues.html*
// @match        *://*.hentaiheroes.com/*home.html*
// @match        *://*.haremheroes.com/*home.html*
// @downloadURL  https://raw.githubusercontent.com/aruuush/several-leagues/main/several_leagues.user.js
// @updateURL    https://raw.githubusercontent.com/aruuush/several-leagues/main/several_leagues.user.js
// @icon         https://cdn3.iconfinder.com/data/icons/sex-6/128/XXX_3-02-512.png
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_info
// ==/UserScript==

if (unsafeWindow.__severalLeaguesInitialized) {
    console.log('[Several Leagues] already initialized, skipping');
    return;
}
unsafeWindow.__severalLeaguesInitialized = true;

function waitForHHPlusPlus(cb) {
    if (unsafeWindow.hhPlusPlusConfig) {
        console.log('[Several Leagues] HH++ already loaded');
        cb();
        return;
    }

    console.log('[Several Leagues] waiting for HHPlusPlus');

    let done = false;

    const finish = () => {
        if (done) return;
        done = true;
        console.log('[Several Leagues] HH++ detected');
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

async function severalLeagues() {
    'use strict';

    const STORAGE_KEY = 'hh_league_starred_players';
    const FILTER_MODE_KEY = 'hh_league_star_filter_mode';
    const SORT_KEY = 'hh_league_sort_state';

    // ------------ Star League Players ------------
    function starInit() {
        function loadStarred() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                return raw ? new Set(JSON.parse(raw)) : new Set();
            } catch (e) {
                console.error('Failed to load starred players', e);
                return new Set();
            }
        }

        function saveStarred(set) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
            } catch (e) {
                console.error('Failed to save starred players', e);
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

                        const mode = localStorage.getItem(FILTER_MODE_KEY) || 'all';
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
            let mode = localStorage.getItem(FILTER_MODE_KEY) || "all";
            updateModeButtons();

            // Button logic
            btnStar.addEventListener('click', () => {
                mode = (mode === "starred" ? "all" : "starred");
                saveMode();
                updateModeButtons();
                applyModeFilter(starredSet, mode);
            });

            btnNonStar.addEventListener('click', () => {
                mode = (mode === "nonstar" ? "all" : "nonstar");
                saveMode();
                updateModeButtons();
                applyModeFilter(starredSet, mode);
            });

            // Initial apply
            applyModeFilter(starredSet, mode);

            function saveMode() {
                localStorage.setItem(FILTER_MODE_KEY, mode);
            }

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

            const mode = localStorage.getItem(FILTER_MODE_KEY) || "all";
            applyModeFilter(starredSet, mode);
        });

        const target = document.querySelector('.data-list') || document.body;
        observer.observe(target, { childList: true, subtree: true });
    }

    // ------------ Local Booster Expiration timer ------------
    function localBoosterExpirationInit() {
        function replaceItemPrice(tooltip, timeText) {
            doWhenSelectorAvailable('.item-price', () => {
                const priceEl = tooltip.querySelector('.item-price');
                if (!priceEl) return false;

                priceEl.innerHTML = '';
                priceEl.style.textAlign = 'center';
                priceEl.style.fontSize = '12px';
                priceEl.style.color = '#ffbf00ff';
                priceEl.style.textShadow = '1px 1px 2px #000';
                priceEl.textContent = `Ends at ${timeText}`;
                return true;
            });
        }

        function buildBoosterExpiryMap() {
            const l = opponents_list;
            if (!Array.isArray(l)) return;

            // Global map: id_member → array of booster objects { id_member_booster_equipped, lifetime }
            window.boosterExpiries = new Map();

            for (let i = 0; i < l.length; i++) {
                const opp = l[i];
                const id = opp.player.id_fighter;
                const boosters = opp.boosters || [];
                if (boosters.length === 0) continue;

                // Convert all boosters → { id_member_booster_equipped, lifetime }
                const boosterObjs = [];
                for (let j = 0; j < boosters.length; j++) {
                    const booster = boosters[j];
                    if (!booster || !booster.lifetime || !booster.id_member_booster_equipped) continue;

                    const exp = Number(booster.lifetime);
                    if (!Number.isFinite(exp)) continue;

                    boosterObjs.push({
                        id_member_booster_equipped: booster.id_member_booster_equipped,
                        lifetime: exp
                    });
                }

                if (boosterObjs.length) {
                    window.boosterExpiries.set(id, boosterObjs);
                }
            }
        }

        buildBoosterExpiryMap();

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

        const fmt = (ts) =>
            new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        document.body.addEventListener(
            'mouseenter',
            (ev) => {
                const slot = ev.target.closest('.boosters .slot[booster-item-tooltip]');
                if (!slot) return;

                const data = safeParse(slot.getAttribute('data-d'));
                if (!data || !data.id_member || !data.id_member_booster_equipped) return;

                const ownerId = data.id_member;
                const boosterId = data.id_member_booster_equipped;

                // get all boosters for this owner
                const boosters = window.boosterExpiries.get(ownerId);
                if (!boosters || !boosters.length) return;

                // find the booster that matches this slot
                const matchingBooster = boosters.find(b => b.id_member_booster_equipped === boosterId);
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
    function sortByBoosterExpirationInit(restore_state = false) {
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

                const boosterObjs = window.boosterExpiries.get(ownerId) || [];
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

            console.log(`[Several Leagues] ✅ Sorted by booster expiration (${desc ? 'latest → earliest' : 'earliest → latest'})`);
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
            if (restore_state) {
                const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
                desc = saved.column === 'boosters'
                    ? saved.direction === 'DESC'
                    : true;
            } else {
                desc = true;
            }
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                // Refresh cached expirations once per click (in case boosters updated)
                document.querySelectorAll('.data-list .data-row.body-row').forEach(r => delete r.dataset.expTs);

                desc = !desc;
                applyVisualOrder(desc);
                icon.className = desc ? 'downArrow_mix_icn' : 'upArrow_mix_icn';

                // SAVE STATE
                if (restore_state) {
                    localStorage.setItem(SORT_KEY, JSON.stringify({
                        column: 'boosters',
                        direction: desc ? 'DESC' : 'ASC'
                    }));
                } else {
                    localStorage.removeItem(SORT_KEY);
                }
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
        if (restore_state) {
            const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}');
            if (saved.column === 'boosters') {
                requestAnimationFrame(() => {
                    applyVisualOrder(saved.direction === 'DESC');
                    icon.className = saved.direction === 'DESC'
                        ? 'downArrow_mix_icn'
                        : 'upArrow_mix_icn';
                });
            }
        }
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

                            console.log('[Several Leagues] ⚡ MultiBattle button armed. Click again to start!');
                        } else {
                            // Second click → let the game handle normally
                            multiBattleArmed = false;
                            console.log('[Several Leagues] 🚀 MultiBattle button clicked!');
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
    function SortPersistenceInit() {
        const headerRow = document.querySelector('.data-row.head-row');
        if (!headerRow) return;

        headerRow.addEventListener('click', (e) => {
            const header = e.target.closest('.head-column');
            if (!header) return;

            const column = header.getAttribute('column');
            if (!column) return;

            // Native columns
            const direction = header.getAttribute('sorting');
            if (!direction) return;

            if (column !== 'boosters') {
                // SAVE STATE
                localStorage.setItem(SORT_KEY, JSON.stringify({
                    column: column,
                    direction: direction === 'DESC' ? 'DESC' : 'ASC'
                }));
            }

            console.log(`[Several Leagues] ✅ Sorted by ${column} (${direction})`);
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
            disableMultiBattleButton:
                { enabled: true },
            restoreSortState:
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
                label: 'Star players in leagues and filter them',
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
                label: 'Show local booster expiration time in tooltips (Hover over booster icon to see expiration in local time)',
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
                baseKey: 'sortByBoosterExpiration',
                label: 'Sort players by booster expiration time (Click header to toggle ascending/descending)',
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
                label: 'Prevent accidental 3x battle clicks (Click once to enable 3x button and again to fight. Not implemented in pre-battle page.)',
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
                baseKey: 'restoreSortState',
                label: 'Makes sort by booster expiration persistent across page reloads',
                default: true,
            },
            run() {
                config.restoreSortState = {
                    enabled: true,
                };
            }
        });
        config.restoreSortState.enabled = false;

        hhLoadConfig();
        runModules();

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

    if (config.restoreSortState.enabled) {
        doWhenSelectorAvailable('.data-row.head-row', SortPersistenceInit);
    }

    if (config.starLeague.enabled) {
        doWhenSelectorAvailable('.data-column.head-column[column="level"]', starInit);
    }

    if (config.localBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.data-list .data-row.body-row', localBoosterExpirationInit);
    }

    if (config.sortByBoosterExpiration.enabled) {
        doWhenSelectorAvailable('.head-column[column="boosters"]', () => sortByBoosterExpirationInit(config.restoreSortState.enabled));
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
}

waitForHHPlusPlus(() => {
    severalLeagues();
});