// runner.js — PDF プレビューの描画役。sandbox="allow-scripts" の iframe（不透明オリジン）の中で動く。
//
// エンジン pdf.js はダウンロード型拡張（id "pdfjs"）で、アプリ本体には含めない。親（Tana）が
// 拡張のファイルの中身と PDF のバイト列を postMessage で渡し、ここで blob: URL から読み込む
// （Fude の PlantUML / Mermaid 拡張と同じ方式）。アプリの API には触れられない。
//
// 親 → { type: 'show', engine: {pdf, worker, cmaps, fonts}, data: ArrayBuffer, dark: boolean }
// 親 ← { type: 'loaded', pages } / { type: 'error', message }
'use strict';

(function () {
  var statusEl = document.getElementById('status');
  var pagesEl = document.getElementById('pages');
  var MAX_PAGES = 500; // それ以上は先頭だけ（プレビューなので）
  var GAP = 20; // 左右の余白(px)

  function post(msg) {
    parent.postMessage(msg, '*');
  }

  function blobUrl(text) {
    return URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  }

  function loadClassic(text) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = blobUrl(text);
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error('PDF エンジンを読み込めませんでした'));
      };
      document.head.appendChild(s);
    });
  }

  function fromBase64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function describe(err) {
    var name = (err && err.name) || '';
    if (name === 'PasswordException') return 'パスワード付きの PDF は表示できません';
    if (name === 'InvalidPDFException') return 'PDF として読めませんでした';
    return 'PDF を表示できませんでした: ' + ((err && err.message) || String(err));
  }

  async function show(msg) {
    if (msg.dark) document.body.classList.add('dark');
    var engine = msg.engine || {};
    var pdfjs = await import(blobUrl(engine.pdf));
    // 解析役（worker）は classic 形式で配っている。不透明オリジンでは blob: の module worker を
    // 起動できないため。Worker を作れない環境では同じスクリプトをここで読み、本スレッドで動かす
    // （遅いが表示はできる。スクリプトが globalThis.pdfjsWorker を用意する）。
    try {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(blobUrl(engine.worker));
    } catch (_err) {
      await loadClassic(engine.worker);
    }

    var cmaps = engine.cmaps ? JSON.parse(engine.cmaps) : {};
    var fonts = engine.fonts ? JSON.parse(engine.fonts) : {};
    // 和文など埋め込みの無いフォントの対応表（CMap）と標準フォントは、拡張に同梱したものを渡す
    function CMapFactory() {}
    CMapFactory.prototype.fetch = function (arg) {
      var b = cmaps[arg.name];
      if (!b) return Promise.reject(new Error('CMap が見つかりません: ' + arg.name));
      return Promise.resolve({ cMapData: fromBase64(b), isCompressed: true });
    };
    function FontFactory() {}
    FontFactory.prototype.fetch = function (arg) {
      var b = fonts[arg.filename];
      if (!b) return Promise.reject(new Error('フォントが見つかりません: ' + arg.filename));
      return Promise.resolve(fromBase64(b));
    };

    var doc = await pdfjs.getDocument({
      data: new Uint8Array(msg.data),
      CMapReaderFactory: CMapFactory,
      StandardFontDataFactory: FontFactory,
      cMapUrl: 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'fonts/',
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;

    var count = Math.min(doc.numPages, MAX_PAGES);
    statusEl.textContent =
      doc.numPages > MAX_PAGES ? '先頭 ' + MAX_PAGES + ' ページのみ表示しています' : '';
    post({ type: 'loaded', pages: doc.numPages });

    var width = Math.max(100, document.documentElement.clientWidth - GAP * 2);
    var ratio = window.devicePixelRatio || 1;
    var first = await doc.getPage(1);
    var base = first.getViewport({ scale: 1 });

    // 先に全ページの枠を置き（スクロールの長さを確定）、見えたページから描く
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          observer.unobserve(en.target);
          renderPage(Number(en.target.dataset.page), en.target);
        });
      },
      { rootMargin: '600px 0px' },
    );

    for (var n = 1; n <= count; n++) {
      var box = document.createElement('div');
      box.className = 'page';
      box.dataset.page = String(n);
      box.style.width = width + 'px';
      box.style.height = Math.round((width * base.height) / base.width) + 'px';
      var no = document.createElement('span');
      no.className = 'page-no';
      no.textContent = n + ' / ' + doc.numPages;
      box.appendChild(no);
      pagesEl.appendChild(box);
      observer.observe(box);
    }

    async function renderPage(n, box) {
      try {
        var page = n === 1 ? first : await doc.getPage(n);
        var unit = page.getViewport({ scale: 1 });
        var scale = width / unit.width;
        var vp = page.getViewport({ scale: scale * ratio });
        box.style.height = Math.round(unit.height * scale) + 'px';
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        box.insertBefore(canvas, box.firstChild);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      } catch (err) {
        box.title = describe(err);
      }
    }
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var msg = e.data || {};
    if (msg.type !== 'show') return;
    show(msg).catch(function (err) {
      statusEl.textContent = describe(err);
      post({ type: 'error', message: describe(err) });
    });
  });

  post({ type: 'ready' });
})();
