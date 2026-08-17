/**
 * My Bug Reports — drop-in embed.
 *
 *   <script src="https://YOUR-BUGREPORTER-HOST/embed/my-bugs.js"
 *           data-api-key="YOUR_APP_API_KEY"
 *           data-email="the.logged.in.user@example.com"></script>
 *
 * That is the whole integration. No build step, no framework, no npm install —
 * it runs in any page that can execute a script tag, which is the point: the
 * React SDK already covers React apps, and everything else had nothing.
 *
 * Optional attributes:
 *   data-mount="#selector"  render inline into that element instead of as a
 *                           floating launcher + drawer
 *   data-label="My bugs"    launcher text
 *   data-api-url="https://…" only if the API lives somewhere other than the
 *                           host this script was served from
 *
 * ── On data-email ────────────────────────────────────────────────────────────
 * The API key identifies the APPLICATION, not the person — it is safe to ship
 * to browsers, and every reporter-scoped endpoint therefore requires an email
 * as well. Render `data-email` from your server-side session. Do NOT read it
 * from a query string or let a user type it: whatever goes here is whose bugs
 * are shown, so a page that takes it from the URL lets anyone read anyone's.
 *
 * ── Degrading ───────────────────────────────────────────────────────────────
 * The stats strip and the status control each depend on an endpoint that may
 * not be deployed yet. Both are probed and simply omitted when absent, so this
 * script keeps working against an older platform rather than erroring.
 */
(function () {
  'use strict';

  // Must be read synchronously: document.currentScript is null once any async
  // work has yielded, and the fallback (last script in the document) is only
  // correct while this one is still executing.
  var SCRIPT =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      return all[all.length - 1];
    })();

  var API_KEY = SCRIPT.getAttribute('data-api-key');
  var EMAIL = SCRIPT.getAttribute('data-email');
  var MOUNT_SELECTOR = SCRIPT.getAttribute('data-mount');
  var LABEL = SCRIPT.getAttribute('data-label') || 'My bug reports';

  // Defaults to wherever this file was served from, so the copied snippet
  // carries its own origin and there is one less thing to configure wrongly.
  var API_URL =
    SCRIPT.getAttribute('data-api-url') ||
    (function () {
      try {
        return new URL(SCRIPT.src).origin;
      } catch (e) {
        return '';
      }
    })();

  if (!API_KEY || !EMAIL) {
    // Loud in the console, silent on the page. A missing key is an integration
    // mistake, and defacing the host app's UI over it helps nobody.
    console.error(
      '[my-bugs] data-api-key and data-email are both required. Panel not rendered.'
    );
    return;
  }

  // Fallback only. When /stats is available its own status_labels win, so a
  // vocabulary change on the platform reaches this script without a redeploy.
  var LABELS = {
    new: 'New',
    seen: 'Seen',
    in_progress: 'In Progress',
    ready_for_testing: 'Ready for Testing',
    resolved: 'Resolved',
    closed: 'Closed',
    wont_fix: "Won't Fix"
  };

  var TONE = {
    new: ['#dbeafe', '#1d4ed8'],
    seen: ['#fef3c7', '#b45309'],
    in_progress: ['#ffedd5', '#c2410c'],
    ready_for_testing: ['#cffafe', '#155e75'],
    resolved: ['#dcfce7', '#15803d'],
    closed: ['#a7f3d0', '#064e3b'],
    wont_fix: ['#f3f4f6', '#374151']
  };

  /** `resolved` is legacy: still displayed, never offered as a new choice. */
  var LEGACY = ['resolved'];

  var state = {
    bugs: [],
    stats: null,
    page: 1,
    totalPages: 1,
    status: '',
    open: false,
    detail: null,
    busy: false,
    canSetStatus: true // flipped off if the endpoint 404s
  };

  // ── api ────────────────────────────────────────────────────────────────────

  function api(path, options) {
    options = options || {};
    return fetch(API_URL + '/api/v1/public/bug-reports' + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (json) {
          if (!res.ok || json.success === false) {
            var err = new Error(
              (json.error && json.error.message) || 'Request failed'
            );
            err.status = res.status;
            throw err;
          }
          return json.data;
        });
    });
  }

  function loadBugs(reset) {
    if (reset) state.page = 1;
    var q =
      '?reporter_email=' +
      encodeURIComponent(EMAIL) +
      '&page=' +
      state.page +
      '&limit=20' +
      (state.status ? '&status=' + encodeURIComponent(state.status) : '');

    return api('/me' + q).then(function (data) {
      var incoming = data.bug_reports || [];
      state.bugs = state.page === 1 ? incoming : state.bugs.concat(incoming);
      state.totalPages = (data.pagination && data.pagination.total_pages) || 1;
    });
  }

  function loadStats() {
    return api('/stats?reporter_email=' + encodeURIComponent(EMAIL))
      .then(function (data) {
        state.stats = data;
        if (data.status_labels) LABELS = data.status_labels;
      })
      .catch(function () {
        // Not deployed, or not permitted. The panel is still useful without it.
        state.stats = null;
      });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  function label(status) {
    return LABELS[status] || status;
  }

  function title(bug) {
    return (
      (bug.metadata && bug.metadata.title) ||
      (bug.description || '').split('\n')[0].slice(0, 90) ||
      'Untitled report'
    );
  }

  function ago(iso) {
    if (!iso) return '';
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    var months = Math.round(days / 30);
    return months + (months === 1 ? ' month ago' : ' months ago');
  }

  /** Escaped everywhere user text meets innerHTML. Bug text is user input. */
  function esc(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"']/g,
      function (c) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }[c];
      }
    );
  }

  function chip(status) {
    var tone = TONE[status] || TONE.wont_fix;
    return (
      '<span class="chip" style="background:' +
      tone[0] +
      ';color:' +
      tone[1] +
      '">' +
      esc(label(status)) +
      '</span>'
    );
  }

  /**
   * What the status dropdown offers.
   *
   * Legacy statuses are hidden unless the bug already carries one, matching the
   * platform's own pickers — a control that both displays and offers a value
   * must still be able to render a value it would never newly propose.
   */
  function offered(current) {
    return Object.keys(LABELS).filter(function (s) {
      if (s === current) return false;
      return LEGACY.indexOf(s) === -1 || current === s;
    });
  }

  // ── styles ─────────────────────────────────────────────────────────────────
  // Shadow DOM, so the host application's CSS cannot reach in and this cannot
  // leak out. An embed that inherits its host's `* { box-sizing }` or a global
  // `button { }` rule looks broken in a way nobody can debug from either side.

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#17181b;color:#fff;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.22)}',
    '.launcher:hover{background:#000}',
    '.backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(15,16,18,.42)}',
    '.drawer{position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw);z-index:2147483001;background:#fff;display:flex;flex-direction:column;box-shadow:-8px 0 32px rgba(0,0,0,.18)}',
    '.inline{border:1px solid #e6e6e3;border-radius:12px;background:#fff;display:flex;flex-direction:column;max-height:720px}',
    '.head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #ececea}',
    '.head h2{font-size:15px;font-weight:700;color:#17181b}',
    '.head p{font-size:12px;color:#6b7280;margin-top:2px}',
    '.x{border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:#6b7280;padding:4px 8px}',
    '.stats{display:flex;gap:8px;padding:12px 18px;border-bottom:1px solid #ececea;overflow-x:auto}',
    '.stat{flex:0 0 auto;min-width:84px;border:1px solid #ececea;border-radius:10px;padding:8px 10px}',
    '.stat b{display:block;font-size:17px;color:#17181b}',
    '.stat span{font-size:11px;color:#6b7280}',
    '.filter{padding:12px 18px;border-bottom:1px solid #ececea}',
    'select,textarea{width:100%;border:1px solid #dcdcd8;border-radius:8px;padding:8px 10px;font-size:13px;background:#fff;color:#17181b}',
    '.list{flex:1 1 auto;overflow-y:auto;padding:8px}',
    '.row{width:100%;text-align:left;border:0;border-bottom:1px solid #f2f2f0;background:transparent;padding:12px 10px;cursor:pointer;display:block}',
    '.row:hover{background:#fafaf9}',
    '.row .t{font-size:13.5px;font-weight:600;color:#17181b;margin-bottom:4px}',
    '.row .m{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#6b7280}',
    '.chip{display:inline-block;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700}',
    '.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#6b7280}',
    '.empty,.err{padding:28px 18px;text-align:center;font-size:13px;color:#6b7280}',
    '.err{color:#b42318}',
    '.more{display:block;width:calc(100% - 20px);margin:10px;padding:9px;border:1px solid #dcdcd8;border-radius:8px;background:#fff;font-size:13px;cursor:pointer}',
    '.detail{flex:1 1 auto;overflow-y:auto;padding:18px}',
    '.detail h3{font-size:16px;font-weight:700;color:#17181b;margin:8px 0 10px}',
    '.detail .desc{font-size:13.5px;color:#2b2d31;white-space:pre-wrap;line-height:1.55;margin-bottom:16px}',
    '.field{margin-bottom:14px}',
    '.field label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;margin-bottom:6px}',
    '.back{border:0;background:transparent;color:#6b7280;font-size:13px;cursor:pointer;padding:0}',
    '.btn{border:0;border-radius:8px;background:#17181b;color:#fff;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer}',
    '.btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.note{font-size:12px;color:#6b7280;margin-top:6px}',
    'img.shot{width:100%;border:1px solid #ececea;border-radius:8px;margin-bottom:14px}'
  ].join('');

  // ── rendering ──────────────────────────────────────────────────────────────

  var host = document.createElement('div');
  var root = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);
  var panel = document.createElement('div');
  root.appendChild(panel);

  function statsHtml() {
    if (!state.stats) return '';
    var t = state.stats.totals || {};
    var cells = [
      ['Total', t.total],
      ['Open', t.open],
      ['Done', t.done]
    ];
    var res = state.stats.resolution || {};
    if (res.median_days != null) cells.push(['Typical fix', res.median_days + 'd']);

    return (
      '<div class="stats">' +
      cells
        .map(function (c) {
          return (
            '<div class="stat"><b>' +
            esc(c[1] == null ? '—' : c[1]) +
            '</b><span>' +
            esc(c[0]) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function listHtml() {
    var options = ['<option value="">All statuses</option>'].concat(
      Object.keys(LABELS).map(function (s) {
        var n = state.stats && state.stats.by_status ? state.stats.by_status[s] : null;
        return (
          '<option value="' +
          esc(s) +
          '"' +
          (state.status === s ? ' selected' : '') +
          '>' +
          esc(label(s)) +
          (n == null ? '' : ' (' + n + ')') +
          '</option>'
        );
      })
    );

    var rows = state.bugs.length
      ? state.bugs
          .map(function (b) {
            return (
              '<button class="row" data-id="' +
              esc(b.id) +
              '"><div class="t">' +
              esc(title(b)) +
              '</div><div class="m"><span class="mono">' +
              esc(b.display_id || '') +
              '</span>' +
              chip(b.status) +
              '<span>' +
              esc(ago(b.created_at)) +
              '</span></div></button>'
            );
          })
          .join('')
      : '<div class="empty">No reports yet.</div>';

    return (
      statsHtml() +
      '<div class="filter"><select class="js-status">' +
      options.join('') +
      '</select></div><div class="list">' +
      rows +
      (state.page < state.totalPages
        ? '<button class="more js-more">Load more</button>'
        : '') +
      '</div>'
    );
  }

  function detailHtml() {
    var b = state.detail;
    var opts = offered(b.status)
      .map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(label(s)) + '</option>';
      })
      .join('');

    return (
      '<div class="detail">' +
      '<button class="back js-back">← All reports</button>' +
      '<h3>' +
      esc(title(b)) +
      '</h3>' +
      '<div class="m" style="margin-bottom:14px">' +
      chip(b.status) +
      ' <span class="mono">' +
      esc(b.display_id || '') +
      '</span></div>' +
      (b.screenshot_url
        ? '<img class="shot" src="' + esc(b.screenshot_url) + '" alt="">'
        : '') +
      '<div class="desc">' +
      esc(b.description || '') +
      '</div>' +
      (state.canSetStatus && opts
        ? '<div class="field"><label>Change status</label><select class="js-to">' +
          opts +
          '</select></div>' +
          '<div class="field"><label>Note (required when reopening)</label>' +
          '<textarea class="js-note" rows="3" placeholder="What changed?"></textarea></div>' +
          '<button class="btn js-apply"' +
          (state.busy ? ' disabled' : '') +
          '>' +
          (state.busy ? 'Saving…' : 'Update status') +
          '</button>'
        : '') +
      '<div class="note js-msg"></div>' +
      '</div>'
    );
  }

  function bodyHtml() {
    return state.detail ? detailHtml() : listHtml();
  }

  function render() {
    var header =
      '<div class="head"><div><h2>' +
      esc(LABEL) +
      '</h2><p>' +
      esc(EMAIL) +
      '</p></div>' +
      (MOUNT_SELECTOR ? '' : '<button class="x js-close">×</button>') +
      '</div>';

    if (MOUNT_SELECTOR) {
      panel.innerHTML = '<div class="inline">' + header + bodyHtml() + '</div>';
    } else if (state.open) {
      panel.innerHTML =
        '<div class="backdrop js-close"></div><div class="drawer">' +
        header +
        bodyHtml() +
        '</div>';
    } else {
      panel.innerHTML =
        '<button class="launcher js-open">🐞 ' + esc(LABEL) + '</button>';
    }
    bind();
  }

  function msg(text, isError) {
    var el = panel.querySelector('.js-msg');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? '#b42318' : '#15803d';
  }

  function bind() {
    var q = function (sel) {
      return panel.querySelector(sel);
    };

    var open = q('.js-open');
    if (open)
      open.onclick = function () {
        state.open = true;
        render();
        refresh();
      };

    panel.querySelectorAll('.js-close').forEach(function (el) {
      el.onclick = function () {
        state.open = false;
        state.detail = null;
        render();
      };
    });

    var sel = q('.js-status');
    if (sel)
      sel.onchange = function () {
        state.status = sel.value;
        loadBugs(true).then(render);
      };

    var more = q('.js-more');
    if (more)
      more.onclick = function () {
        state.page += 1;
        loadBugs().then(render);
      };

    panel.querySelectorAll('.row').forEach(function (el) {
      el.onclick = function () {
        var id = el.getAttribute('data-id');
        state.detail = state.bugs.filter(function (b) {
          return b.id === id;
        })[0];
        render();
      };
    });

    var back = q('.js-back');
    if (back)
      back.onclick = function () {
        state.detail = null;
        render();
      };

    var apply = q('.js-apply');
    if (apply)
      apply.onclick = function () {
        var to = q('.js-to').value;
        var note = q('.js-note').value.trim();
        state.busy = true;
        render();

        api('/' + state.detail.id + '/status', {
          method: 'POST',
          body: { status: to, reporter_email: EMAIL, note: note || undefined }
        })
          .then(function () {
            state.busy = false;
            state.detail = null;
            return Promise.all([loadBugs(true), loadStats()]).then(render);
          })
          .catch(function (err) {
            state.busy = false;
            // A 404 means this platform predates the status endpoint. Hide the
            // control rather than leaving a button that can only ever fail.
            if (err.status === 404) state.canSetStatus = false;
            render();
            msg(err.message, true);
          });
      };
  }

  function refresh() {
    return Promise.all([loadBugs(true), loadStats()])
      .then(render)
      .catch(function (err) {
        panel.innerHTML =
          '<div class="inline"><div class="err">' +
          esc(err.message) +
          '</div></div>';
      });
  }

  // ── mount ──────────────────────────────────────────────────────────────────

  function mount() {
    var target = MOUNT_SELECTOR ? document.querySelector(MOUNT_SELECTOR) : document.body;
    if (!target) {
      console.error('[my-bugs] data-mount selector matched nothing:', MOUNT_SELECTOR);
      return;
    }
    target.appendChild(host);
    render();
    // Inline mounts are on screen immediately, so they fetch immediately. The
    // floating launcher waits for a click — no reason to spend a request on a
    // panel most visitors never open.
    if (MOUNT_SELECTOR) refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
