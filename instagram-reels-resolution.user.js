// ==UserScript==
// @name         인스타그램 릴스 해상도 표시
// @namespace    local.instagram.reels.resolution
// @version      1.2.0
// @description  릴스와 스토리에서 보고 있는 영상이나 사진의 해상도를 작게 표시합니다.
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const reelsPath = /^\/(?:reels(?:\/|$)|(?:[^/]+\/)?reel\/[^/]+(?:\/|$))/;
    const storiesPath = /^\/stories\/[^/]+(?:\/\d+)?\/?$/;
    const storyHeaderGap = 10;
    const storyDefaultInset = 80;
    const visibilityOptions = { opacityProperty: true, visibilityProperty: true };
    const intersections = new Map();
    let updateScheduled = false;

    const badge = document.createElement('span');
    badge.id = 'tm-instagram-reels-resolution';
    Object.assign(badge.style, {
        all: 'initial',
        position: 'fixed',
        zIndex: '2147483647',
        pointerEvents: 'none',
        padding: '3px 6px',
        borderRadius: '5px',
        backgroundColor: 'rgba(0, 0, 0, 0.74)',
        color: '#fff',
        font: '600 11px/1.2 system-ui, sans-serif',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
    });

    // 미리 로드된 영상이나 사진 중에서 화면에 실제로 보이는 항목을 고릅니다.
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (intersections.has(entry.target)) {
                intersections.set(entry.target, entry.intersectionRatio);
            }
        }
        scheduleUpdate();
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });

    function findVisibleMedia(isStory) {
        const candidates = new Set();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const centerX = viewportWidth / 2;
        let best = null;
        for (const media of document.querySelectorAll(isStory ? 'video, img' : 'video')) {
            const rect = media.getBoundingClientRect();
            const left = Math.max(0, rect.left);
            const top = Math.max(0, rect.top);
            const visibleWidth = Math.min(viewportWidth, rect.right) - left;
            const visibleHeight = Math.min(viewportHeight, rect.bottom) - top;
            if (visibleWidth < 80 || visibleHeight < 80) continue;
            // 가운데에 있는 큰 미디어를 골라 프로필 사진과 옆쪽 스토리 미리보기를 제외합니다.
            if (isStory && (visibleWidth < 140 || visibleHeight < 180 || centerX < left || centerX > rect.right)) continue;

            candidates.add(media);
            if (!intersections.has(media)) {
                intersections.set(media, 0);
                observer.observe(media);
            }

            const ratio = intersections.get(media);
            if (!ratio || media.checkVisibility?.(visibilityOptions) === false) continue;

            const visibleArea = Math.min(visibleWidth * visibleHeight, rect.width * rect.height * ratio);
            const isVideo = media.tagName === 'VIDEO';
            // 스토리 영상과 표지 이미지가 겹쳐 있으면 영상의 해상도를 우선합니다.
            const preferVideo = isVideo && (isStory || (!media.paused && !media.ended));
            const score = visibleArea * (preferVideo ? 1.2 : 1);
            if (!best || score > best.score) best = { media, isVideo, score, left, top };
        }

        for (const media of intersections.keys()) {
            if (!candidates.has(media)) {
                observer.unobserve(media);
                intersections.delete(media);
            }
        }

        return best;
    }

    function getStoryBadgeTop(active) {
        const { left, right } = active.media.getBoundingClientRect();
        const controls = document.querySelectorAll('header, [role="banner"], button, [role="button"], a[href], [role="link"]');
        let headerBottom = 0;

        // 본문과 양옆 미리보기를 제외하고, 현재 스토리 상단에 있는 조작 요소만 봅니다.
        for (const control of controls) {
            const rect = control.getBoundingClientRect();
            if (rect.width < 12 || rect.height < 12 || rect.height > 80) continue;
            if (rect.left < left - 4 || rect.right > right + 4) continue;
            if (rect.top < active.top - 4 || rect.top > active.top + 80 || rect.bottom > active.top + 120) continue;
            if (control.checkVisibility?.(visibilityOptions) === false) continue;
            headerBottom = Math.max(headerBottom, rect.bottom);
        }

        return Math.round(headerBottom ? headerBottom + storyHeaderGap : active.top + storyDefaultInset);
    }

    function update() {
        updateScheduled = false;
        const path = location.pathname;
        const isStory = storiesPath.test(path);
        if (!isStory && !reelsPath.test(path)) {
            observer.disconnect();
            intersections.clear();
            badge.remove();
            return;
        }

        const active = findVisibleMedia(isStory);
        if (!active || (!active.isVideo && !active.media.complete)) {
            badge.remove();
            return;
        }

        const { media, isVideo } = active;
        const width = isVideo ? media.videoWidth : media.naturalWidth;
        const height = isVideo ? media.videoHeight : media.naturalHeight;
        if (!width || !height) {
            badge.remove();
            return;
        }

        const label = `${width} × ${height}`;
        badge.title = isVideo ? '현재 영상 해상도' : '현재 사진 해상도';
        if (badge.textContent !== label) badge.textContent = label;
        const top = isStory ? getStoryBadgeTop(active) : Math.round(active.top) + 8;
        badge.style.left = `${Math.round(active.left) + 8}px`;
        badge.style.top = `${top}px`;
        if (!badge.isConnected) document.body.append(badge);
    }

    function scheduleUpdate() {
        if (updateScheduled || document.hidden) return;
        const path = location.pathname;
        if (!intersections.size && !reelsPath.test(path) && !storiesPath.test(path)) return;

        updateScheduled = true;
        requestAnimationFrame(update);
    }

    // video의 resize는 화면에 배치된 크기가 아닌 영상 자체의 크기가 바뀔 때 발생합니다.
    for (const event of ['load', 'loadedmetadata', 'resize', 'emptied', 'play', 'pause', 'ended']) {
        document.addEventListener(event, scheduleUpdate, true);
    }

    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('popstate', scheduleUpdate);
    document.addEventListener('visibilitychange', scheduleUpdate);

    // 인스타그램 내부 이동과 늦게 만들어진 플레이어도 감지합니다.
    window.setInterval(scheduleUpdate, 750);
    scheduleUpdate();
})();
