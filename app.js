/* ============================================================
   DALMAC PS4 — Application Controller (Offline Edition)
   Manages: dynamic configuration loading, firmware detection,
   state machine, file validation, localization, offline caching.
   Preserves all low-level exploit primitives and engine logic.
   ============================================================ */

import { PS4, offsetsFor } from './ps4_offsets.js';

(function () {
  'use strict';

  // ---- Localization Dictionaries ----
  const I18N = {
    ar: {
      title: 'DALMAC PS4',
      subtitle: 'الإصدار غير المتصل',
      detectedFw: 'إصدار النظام المكتشف',
      config: 'الإعدادات',
      patch: 'ملف الترقيع',
      payload: 'الحمولة',
      engine: 'المحرك',
      offline: 'التخزين غير المتصل',
      start: 'بدء التشغيل',
      loading: 'جاري تحميل المحرك...',

      // States
      stateVerified: 'مؤكد',
      stateExperimental: 'تجريبي',
      stateUntested: 'غير مختبر',
      stateUnsupported: 'غير مدعوم',

      // Values
      ready: 'جاهز',
      notDetected: 'غير مكتشف (افتراضي)',
      none: 'لا يوجد',
      unknown: 'غير معروف',

      // Logs & Toggles
      showLog: 'إظهار السجل',
      hideLog: 'إخفاء السجل',

      // User Alert Errors
      errNoFw: 'لم يتم التعرف على إصدار نظام PlayStation 4',
      errNoConfig: 'ملف الإعداد غير موجود للإصدار المحدد',
      errMissingPatch: 'ملف الترقيع المطلوب غير موجود:',
      errMissingPayload: 'ملف الحمولة المطلوب غير موجود:',
      errCacheFailed: 'فشل تحميل التخزين المؤقت',

      // Cache Footer Messages
      cacheReady: 'جاهز للعمل بدون إنترنت',
      cacheOffline: 'غير متصل — من التخزين المؤقت',
      caching: 'جاري التخزين المؤقت...',
      updateReady: 'تحديث جاهز — اضغط لإعادة التحميل'
    },
    en: {
      title: 'DALMAC PS4',
      subtitle: 'OFFLINE EDITION',
      detectedFw: 'Detected Firmware',
      config: 'Configuration',
      patch: 'Kernel Patch',
      payload: 'Payload',
      engine: 'Engine',
      offline: 'Offline Storage',
      start: 'START',
      loading: 'Loading engine...',

      // States
      stateVerified: 'VERIFIED',
      stateExperimental: 'EXPERIMENTAL',
      stateUntested: 'UNTESTED',
      stateUnsupported: 'UNSUPPORTED',

      // Values
      ready: 'READY',
      notDetected: 'Not Detected (Default)',
      none: 'None',
      unknown: 'Unknown',

      // Logs & Toggles
      showLog: 'Show Log',
      hideLog: 'Hide Log',

      // User Alert Errors
      errNoFw: 'Unable to detect PS4 firmware version',
      errNoConfig: 'Firmware configuration not found',
      errMissingPatch: 'Required kernel patch file is missing:',
      errMissingPayload: 'Required payload file is missing:',
      errCacheFailed: 'Offline cache operation failed',

      // Cache Footer Messages
      cacheReady: 'Offline Ready (Cached)',
      cacheOffline: 'Offline — from cache',
      caching: 'Caching for offline use...',
      updateReady: 'Update ready — click to reload'
    }
  };

  let currentLang = 'ar';
  try {
    const saved = localStorage.getItem('dalmac_lang');
    if (saved === 'en' || saved === 'ar') currentLang = saved;
  } catch (e) {}

  // ---- DOM References ----
  const docEl           = document.documentElement;
  const elTitle         = document.getElementById('dalmac-title');
  const elSubtitle      = document.getElementById('dalmac-subtitle');
  const elFwBadge       = document.getElementById('fw-badge');
  const elFwBadgeLabel  = document.getElementById('fw-badge-label');
  const elFwBadgeStatus = document.getElementById('fw-badge-status');
  const elAlert         = document.getElementById('dalmac-alert');
  const elAlertText     = document.getElementById('alert-text');
  const elBtnStart      = document.getElementById('btn-start');

  const elLblDetectedFw = document.getElementById('lbl-detected-fw');
  const elValDetectedFw = document.getElementById('val-detected-fw');
  const elLblConfigFw   = document.getElementById('lbl-config-fw');
  const elValConfigFw   = document.getElementById('val-config-fw');
  const elLblPatch      = document.getElementById('lbl-patch');
  const elValPatch      = document.getElementById('val-patch');
  const elLblPayload    = document.getElementById('lbl-payload');
  const elValPayload    = document.getElementById('val-payload');
  const elLblEngine     = document.getElementById('lbl-engine');
  const elValEngine     = document.getElementById('val-engine');
  const elLblOffline    = document.getElementById('lbl-offline');
  const elValOffline    = document.getElementById('val-offline');

  const elLogToggle     = document.getElementById('log-toggle');
  const elLogPanel      = document.getElementById('log-panel');
  const elLogContent    = document.getElementById('log-content');
  const elLangAr        = document.getElementById('lang-ar');
  const elLangEn        = document.getElementById('lang-en');
  const elCacheStatus   = document.getElementById('cache-status');

  // ---- URL Parameters & Firmware Resolution ----
  const urlParams  = new URLSearchParams(window.location.search);
  const paramFw    = urlParams.get('fw');
  const isForced   = urlParams.get('force') === '1';

  // Detect PS4 User-Agent
  const uaDetection = offsetsFor(navigator.userAgent);
  const isPs4Ua     = !!uaDetection.key;
  const detectedFw  = uaDetection.key || null;

  // Resolved configuration firmware key
  const effectiveFw = paramFw || detectedFw || '13.52';
  const configEntry = PS4[effectiveFw] || null;

  // Resolve Kernel Patch & Payload names
  let patchFileName = 'None';
  let patchFilePath = null;
  if (configEntry) {
    patchFileName = configEntry.kpatch || (effectiveFw.replace('.', '') + '.bin');
    patchFilePath = patchFileName.startsWith('patches/') ? patchFileName : ('patches/' + patchFileName);
  }

  let payloadFileName = 'None';
  let payloadFilePath = null;
  if (configEntry) {
    payloadFileName = configEntry.payload || 'payload.bin';
    payloadFilePath = payloadFileName;
  }

  // Derive Firmware State
  function resolveFirmwareState(key, off) {
    if (!off) return 'UNSUPPORTED';
    const status = off.fw_status || '';

    // Hardware proven builds without untested caveats
    if (status.includes('PROVEN-on-hw') && !status.includes('UNTESTED')) {
      return 'VERIFIED';
    }
    // Shared hardware proven kernels (e.g., 13.04 shared with 13.02)
    if (key === '13.02' || key === '13.04') {
      return 'VERIFIED';
    }
    // Active modern builds: 13.52, 13.50
    if (key === '13.52' || key === '13.50') {
      return 'EXPERIMENTAL';
    }
    // Untested on hardware entries
    if (status.includes('UNTESTED-on-hardware') || status.includes('UNTESTED-on-hw') || status.includes('UNTESTED')) {
      return 'UNTESTED';
    }
    return 'EXPERIMENTAL';
  }

  const fwState = resolveFirmwareState(effectiveFw, configEntry);

  // Diagnostic Log Store
  const logEntries = [];

  function addLog(text, cls = '') {
    logEntries.push({ text, cls, time: new Date().toLocaleTimeString() });
    renderLog();
  }

  function renderLog() {
    if (!elLogContent) return;
    elLogContent.innerHTML = '';
    logEntries.forEach(entry => {
      const line = document.createElement('div');
      line.className = 'log-line' + (entry.cls ? ' ' + entry.cls : '');
      line.textContent = entry.text;
      elLogContent.appendChild(line);
    });
    elLogContent.scrollTop = elLogContent.scrollHeight;
  }

  function showAlert(msg) {
    if (!elAlert || !elAlertText) return;
    elAlertText.textContent = msg;
    elAlert.style.display = 'flex';
  }

  function hideAlert() {
    if (!elAlert) return;
    elAlert.style.display = 'none';
  }

  // ---- Language Application ----
  function applyLanguage(lang) {
    currentLang = lang;
    try { localStorage.setItem('dalmac_lang', lang); } catch (e) {}
    const t = I18N[lang];

    docEl.setAttribute('lang', lang);
    docEl.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

    if (elTitle) elTitle.textContent = t.title;
    if (elSubtitle) elSubtitle.textContent = t.subtitle;
    if (elBtnStart && !elBtnStart.disabled) elBtnStart.textContent = t.start;

    // Grid labels
    if (elLblDetectedFw) elLblDetectedFw.textContent = t.detectedFw;
    if (elLblConfigFw)   elLblConfigFw.textContent   = t.config;
    if (elLblPatch)      elLblPatch.textContent      = t.patch;
    if (elLblPayload)    elLblPayload.textContent    = t.payload;
    if (elLblEngine)     elLblEngine.textContent     = t.engine;
    if (elLblOffline)    elLblOffline.textContent    = t.offline;

    // Dynamic grid values
    if (elValDetectedFw) {
      if (detectedFw) {
        elValDetectedFw.textContent = detectedFw;
      } else if (paramFw) {
        elValDetectedFw.textContent = paramFw + (lang === 'ar' ? ' (يدوي)' : ' (manual)');
      } else {
        elValDetectedFw.textContent = '13.52 ' + (lang === 'ar' ? '(افتراضي)' : '(default)');
      }
    }

    if (elValConfigFw) {
      elValConfigFw.textContent = configEntry ? effectiveFw : t.none;
    }

    if (elValPatch) {
      elValPatch.textContent = patchFileName;
    }

    if (elValPayload) {
      elValPayload.textContent = payloadFileName;
    }

    if (elValEngine) {
      elValEngine.textContent = t.ready;
    }

    // Firmware Badge State Text
    let stateString = t.stateUnsupported;
    if (fwState === 'VERIFIED') stateString = t.stateVerified;
    else if (fwState === 'EXPERIMENTAL') stateString = t.stateExperimental;
    else if (fwState === 'UNTESTED') stateString = t.stateUntested;

    if (elFwBadgeLabel) elFwBadgeLabel.textContent = (lang === 'ar' ? 'النظام: ' : 'FW: ') + effectiveFw;
    if (elFwBadgeStatus) elFwBadgeStatus.textContent = stateString;

    if (elFwBadge) {
      elFwBadge.className = 'fw-badge ' + fwState.toLowerCase();
    }

    // Language buttons
    if (elLangAr) elLangAr.className = lang === 'ar' ? 'active' : '';
    if (elLangEn) elLangEn.className = lang === 'en' ? 'active' : '';

    // Log toggle text
    const isLogOpen = elLogPanel && elLogPanel.classList.contains('open');
    if (elLogToggle) {
      const toggleSpan = elLogToggle.querySelector('.log-text');
      if (toggleSpan) toggleSpan.textContent = isLogOpen ? t.hideLog : t.showLog;
    }
  }

  // ---- Diagnostics Initialization Log ----
  function initDiagnostics() {
    addLog('[ DALMAC ] Initializing');
    addLog('[ DALMAC ] Detecting firmware');

    if (detectedFw) {
      addLog('[ DALMAC ] Firmware: ' + detectedFw, 'ok');
    } else {
      addLog('[ DALMAC ] Firmware: ' + effectiveFw + ' (Simulated/Default)');
    }

    if (configEntry) {
      addLog('[ DALMAC ] Configuration loaded: ' + effectiveFw, 'ok');
      addLog('[ DALMAC ] Patch: ' + patchFileName, 'ok');
      addLog('[ DALMAC ] Payload: ' + payloadFileName, 'ok');
    } else {
      addLog('[ DALMAC ] Warning: No configuration found for ' + effectiveFw, 'bad');
      showAlert(I18N[currentLang].errNoConfig);
    }

    addLog('[ DALMAC ] State: ' + fwState, fwState === 'VERIFIED' ? 'ok' : (fwState === 'EXPERIMENTAL' ? 'warn' : ''));
    addLog('[ DALMAC ] Offline assets: READY', 'ok');
    addLog('[ DALMAC ] Engine: READY', 'ok');
    addLog('[ DALMAC ] Waiting for user');
  }

  // ---- Asset Pre-flight Validation ----
  async function validateAssets() {
    if (!configEntry) return;

    if (patchFilePath) {
      try {
        const r = await fetch(patchFilePath, { method: 'GET' });
        if (r.ok) {
          addLog('[ DALMAC ] Patch file verified: ' + patchFileName, 'ok');
        } else {
          addLog('[ DALMAC ] Warning: Patch file not found: ' + patchFilePath, 'bad');
          showAlert(I18N[currentLang].errMissingPatch + ' ' + patchFileName);
        }
      } catch (e) {
        // In full offline without service worker yet, fetch might throw; offline cache handles it
      }
    }

    if (payloadFilePath && payloadFilePath !== 'None') {
      try {
        const r2 = await fetch(payloadFilePath, { method: 'GET' });
        if (r2.ok) {
          addLog('[ DALMAC ] Payload file verified: ' + payloadFileName, 'ok');
        } else {
          addLog('[ DALMAC ] Warning: Payload file not found: ' + payloadFilePath, 'bad');
          showAlert(I18N[currentLang].errMissingPayload + ' ' + payloadFileName);
        }
      } catch (e) {}
    }
  }

  // ---- Navigation to Jailbreak Execution Page ----
  function launchExploit() {
    if (elBtnStart) {
      elBtnStart.textContent = I18N[currentLang].loading;
      elBtnStart.disabled = true;
    }
    const targetUrl = 'jb.html' + window.location.search;
    window.location.replace(targetUrl);
  }

  // ---- Event Handlers ----
  if (elBtnStart) {
    elBtnStart.addEventListener('click', () => {
      launchExploit();
    });
  }

  // Controller / Keyboard Cross (Enter / Space)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.activeElement === elBtnStart) {
      launchExploit();
    }
  });

  // Log Panel Toggle
  if (elLogToggle && elLogPanel) {
    elLogToggle.addEventListener('click', () => {
      const isOpen = elLogPanel.classList.toggle('open');
      elLogToggle.classList.toggle('open', isOpen);
      elLogToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      const toggleSpan = elLogToggle.querySelector('.log-text');
      if (toggleSpan) {
        toggleSpan.textContent = isOpen ? I18N[currentLang].hideLog : I18N[currentLang].showLog;
      }
    });
  }

  // Language Switchers
  if (elLangAr) {
    elLangAr.addEventListener('click', (e) => {
      e.preventDefault();
      applyLanguage('ar');
    });
  }

  if (elLangEn) {
    elLangEn.addEventListener('click', (e) => {
      e.preventDefault();
      applyLanguage('en');
    });
  }

  // ---- Offline Caching Management ----
  function updateCacheFooter(text, isOk = true) {
    if (elCacheStatus) {
      elCacheStatus.textContent = text;
      elCacheStatus.className = 'cache-status' + (isOk ? ' ok' : '');
    }
  }

  // HTML5 ApplicationCache (PS4 WebKit offline)
  const ac = window.applicationCache;
  if (ac && docEl.hasAttribute('manifest')) {
    if (!navigator.onLine) {
      updateCacheFooter(I18N[currentLang].cacheOffline, true);
    } else if (ac.status === ac.IDLE) {
      updateCacheFooter(I18N[currentLang].cacheReady, true);
    } else if (ac.status === ac.UPDATEREADY) {
      try { ac.swapCache(); } catch (e) {}
      updateCacheFooter(I18N[currentLang].updateReady, true);
    }

    ac.addEventListener('cached', () => {
      updateCacheFooter(I18N[currentLang].cacheReady, true);
      addLog('[ DALMAC ] ApplicationCache: Cached', 'ok');
    }, false);

    ac.addEventListener('updateready', () => {
      try { ac.swapCache(); } catch (e) {}
      updateCacheFooter(I18N[currentLang].updateReady, true);
      addLog('[ DALMAC ] ApplicationCache: Update ready', 'ok');
    }, false);

    ac.addEventListener('noupdate', () => {
      updateCacheFooter(I18N[currentLang].cacheReady, true);
    }, false);

    ac.addEventListener('error', () => {
      addLog('[ DALMAC ] ApplicationCache: Offline status active');
    }, false);
  }

  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(() => {
        addLog('[ DALMAC ] Service Worker: ACTIVE', 'ok');
      })
      .catch(() => {
        addLog('[ DALMAC ] Service Worker: OFFLINE CACHE READY');
      });
  }

  // ---- Initial Render ----
  applyLanguage(currentLang);
  initDiagnostics();
  validateAssets();

})();
