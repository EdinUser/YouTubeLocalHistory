(function () {
    'use strict';

    const ROOT_ID = 'ytvht-announcement';

    function message(key, fallback) {
        try {
            return chrome.i18n?.getMessage(key) || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function sendMessage(type, payload = {}) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type, ...payload }, (response) => {
                    if (chrome.runtime.lastError) return resolve(null);
                    resolve(response || null);
                });
            } catch (_) {
                resolve(null);
            }
        });
    }

    function isDarkTheme() {
        return document.documentElement.hasAttribute('dark')
            || !!document.querySelector('ytd-app[dark]');
    }

    function isAcknowledged(announcement) {
        try {
            // Any stored value is terminal. Treat malformed site storage as
            // acknowledged so a storage problem cannot turn into a nag.
            return window.localStorage.getItem(announcement.storageKey) !== null;
        } catch (_) {
            return true;
        }
    }

    function acknowledge(announcement) {
        try {
            window.localStorage.setItem(announcement.storageKey, '1');
            return true;
        } catch (_) {
            return false;
        }
    }

    function mount(announcement) {
        if (document.getElementById(ROOT_ID)) return;
        const host = document.createElement('section');
        host.id = ROOT_ID;
        host.setAttribute('role', 'status');
        host.setAttribute('aria-label', message(announcement.titleKey, announcement.title));
        host.dataset.theme = isDarkTheme() ? 'dark' : 'light';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; font-family: Roboto, Arial, sans-serif; }
                .toast { box-sizing: border-box; width: min(360px, calc(100vw - 40px)); padding: 16px; border: 1px solid #b8c8eb; border-radius: 12px; background: #f4f7ff; color: #172033; box-shadow: 0 8px 24px rgb(0 0 0 / 18%); }
                :host([data-theme="dark"]) .toast { border-color: #536889; background: #252b38; color: #edf2ff; box-shadow: 0 8px 24px rgb(0 0 0 / 42%); }
                h2 { margin: 0 0 6px; font: 600 15px/20px Roboto, Arial, sans-serif; }
                p { margin: 0; font: 400 14px/20px Roboto, Arial, sans-serif; }
                .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
                button { min-height: 32px; border: 0; border-radius: 16px; padding: 0 13px; font: 500 14px/32px Roboto, Arial, sans-serif; cursor: pointer; }
                button:focus-visible { outline: 2px solid #2f6fed; outline-offset: 2px; }
                .dismiss { background: transparent; color: #344b75; }
                .action { background: #315ea8; color: #fff; }
                :host([data-theme="dark"]) .dismiss { color: #c4d2ef; }
                :host([data-theme="dark"]) .action { background: #8ab4f8; color: #14213a; }
            </style>
            <div class="toast">
                <h2></h2><p></p>
                <div class="actions"><button class="dismiss" type="button"></button><button class="action" type="button"></button></div>
            </div>`;
        shadow.querySelector('h2').textContent = message(announcement.titleKey, announcement.title);
        shadow.querySelector('p').textContent = message(announcement.bodyKey, announcement.body);
        shadow.querySelector('.dismiss').textContent = message('announcement_dismiss', 'Dismiss');
        shadow.querySelector('.action').textContent = message(announcement.actionLabelKey, announcement.actionLabel);

        const remove = () => host.remove();
        shadow.querySelector('.dismiss').addEventListener('click', async () => {
            if (!acknowledge(announcement)) return;
            await sendMessage('releaseAnnouncement', { announcementId: announcement.id });
            remove();
        });
        shadow.querySelector('.action').addEventListener('click', async () => {
            if (!(await sendMessage('runAnnouncementAction', { announcementId: announcement.id }))?.ok) return;
            if (!acknowledge(announcement)) return;
            remove();
        });
        document.body.appendChild(host);

        new MutationObserver(() => {
            host.dataset.theme = isDarkTheme() ? 'dark' : 'light';
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    }

    async function showNextAnnouncement() {
        if (document.getElementById(ROOT_ID)) return;
        if (location.hostname !== 'www.youtube.com') return;
        const result = await sendMessage('getAnnouncements');
        const announcement = (result?.announcements || []).find((candidate) => !isAcknowledged(candidate));
        if (!announcement) return;
        const claim = await sendMessage('claimAnnouncement', { announcementId: announcement.id });
        if (claim?.show && document.body) mount(announcement);
    }

    if (document.body) showNextAnnouncement();
    else document.addEventListener('DOMContentLoaded', showNextAnnouncement, { once: true });
})();
