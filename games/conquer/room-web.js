/* CONQUER! online play on the website.
 * Inside claude.ai the game uses the artifact "room" capability. On the website there is no such host,
 * so this file gives the game the same room API (join, emit, on, presence, peers, onPeers, connection, leave)
 * on top of Supabase Realtime: broadcast for messages, presence for players. Nothing is stored anywhere.
 * Only the "room" capability is provided; everything else resolves null, as in a view that cannot run it. */
(function () {
  if (window.claude && window.claude.use) return; // a real host is present (claude.ai): leave it alone
  var URL_ = 'https://whxglpmudiknueuzdovi.supabase.co';
  var KEY = 'sb_publishable_-CE2t1csb5IsiAxTF8XT-g_BPixEX_s'; // public browser key
  var SCRIPT = (document.currentScript && document.currentScript.src || '').replace(/room-web\.js.*$/, 'vendor/supabase.js');
  var ME = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10); // one per page load, like the host's `peer`
  var client = null, loading = null;

  function load() {
    if (client) return Promise.resolve(client);
    if (!loading) loading = new Promise(function (ok, bad) {
      var go = function () {
        try { client = window.supabase.createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 40 } } }); ok(client); }
        catch (e) { bad(e); }
      };
      if (window.supabase && window.supabase.createClient) return go();
      var s = document.createElement('script'); s.src = SCRIPT; s.async = true;
      s.onload = go; s.onerror = function () { loading = null; bad(new Error('load')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  var freeze = Object.freeze;
  function sender(peer) { return { peer: peer, by: null, isMe: peer === ME, sameTab: peer === ME, kind: 'viewer', guest: false }; }
  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }

  function makeRoom(name, ch) {
    var listeners = {}, peerFns = [], connFns = [], mine = {}, snapshot = freeze([]), byPeer = {}, up = false, left = false;
    var pending = null, frame = 0, trackT = 0;

    var jsonOf = {};
    function rebuild() {
      var state = ch.presenceState(), next = {}, nextJson = {}, list = [];
      var add = function (k, p) {
        var json = JSON.stringify(p), old = byPeer[k];
        var peer = old && jsonOf[k] === json ? old : freeze(Object.assign(sender(k), { presence: freeze(JSON.parse(json)), updatedAt: Date.now() }));
        next[k] = peer; nextJson[k] = json; list.push(peer);
      };
      add(ME, mine); // your own presence applies locally at once; you are always in the list
      Object.keys(state).forEach(function (k) {
        var metas = state[k]; if (k === ME || !metas || !metas.length) return;
        add(k, metas[metas.length - 1].p || {});
      });
      var joined = [], gone = [], updated = [];
      Object.keys(next).forEach(function (k) { if (!byPeer[k]) joined.push(next[k]); else if (byPeer[k] !== next[k]) updated.push(next[k]); });
      Object.keys(byPeer).forEach(function (k) { if (!next[k]) gone.push(byPeer[k]); });
      byPeer = next; jsonOf = nextJson; snapshot = freeze(list);
      if (!joined.length && !gone.length && !updated.length) return;
      pending = pending || { joined: [], left: [], updated: [] };
      pending.joined = pending.joined.concat(joined); pending.left = pending.left.concat(gone); pending.updated = pending.updated.concat(updated);
      if (!frame) frame = (window.requestAnimationFrame || setTimeout)(flush);
    }
    function flush() {
      frame = 0; if (!pending || left) return;
      var c = freeze({ peers: snapshot, joined: freeze(pending.joined), left: freeze(pending.left), updated: freeze(pending.updated) });
      pending = null;
      peerFns.slice().forEach(function (f) { try { f(c); } catch (e) { setTimeout(function () { throw e; }); } });
    }
    function setUp(v) {
      if (v === up) return; up = v;
      connFns.slice().forEach(function (f) { try { f(up); } catch (e) {} });
    }
    function track() {
      clearTimeout(trackT);
      trackT = setTimeout(function () { if (!left && up) ch.track({ p: mine }).catch(function () {}); }, 30);
    }

    ch.on('broadcast', { event: 'm' }, function (msg) {
      var b = msg.payload || {}; var fns = listeners[b.t]; if (!fns || left) return;
      var m = freeze(Object.assign(sender(b.f), { topic: b.t, data: b.d }));
      fns.slice().forEach(function (f) { try { f(m); } catch (e) { setTimeout(function () { throw e; }); } });
    });
    ch.on('presence', { event: 'sync' }, rebuild);

    var room = {
      name: name,
      emit: function (topic, data) {
        if (left) return Promise.reject(err('invalid_argument', 'left'));
        if (!up) return Promise.resolve(); // dropped while disconnected, like the host
        return ch.send({ type: 'broadcast', event: 'm', payload: { t: topic, f: ME, d: data } }).then(function () {});
      },
      on: function (topic, fn) {
        if (typeof fn !== 'function') throw new TypeError('handler');
        (listeners[topic] = listeners[topic] || []).push(fn);
        return function () { var a = listeners[topic] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
      },
      presence: function (patch) {
        if (left) return Promise.reject(err('invalid_argument', 'left'));
        Object.keys(patch || {}).forEach(function (k) { if (patch[k] === null) delete mine[k]; else mine[k] = patch[k]; });
        rebuild(); track(); return Promise.resolve();
      },
      peers: function () { return snapshot; },
      onPeers: function (fn) {
        peerFns.push(fn);
        setTimeout(function () { if (peerFns.indexOf(fn) < 0) return; fn(freeze({ peers: snapshot, joined: snapshot, left: freeze([]), updated: freeze([]) })); }, 0);
        return function () { var i = peerFns.indexOf(fn); if (i >= 0) peerFns.splice(i, 1); };
      },
      connected: function () { return up; },
      onConnection: function (fn) {
        connFns.push(fn); setTimeout(function () { if (connFns.indexOf(fn) >= 0) fn(up); }, 0);
        return function () { var i = connFns.indexOf(fn); if (i >= 0) connFns.splice(i, 1); };
      },
      leave: function () {
        if (left) return Promise.resolve(); left = true; listeners = {}; peerFns = []; connFns = [];
        delete rooms[name];
        return client.removeChannel(ch).then(function () {}, function () {});
      },
      _status: function (s) {
        if (s === 'SUBSCRIBED') { setUp(true); if (Object.keys(mine).length) track(); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') setUp(false);
      },
    };
    rebuild();
    return room;
  }

  var rooms = {};
  function join(name) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(String(name))) return Promise.reject(err('invalid_argument', 'room name'));
    if (rooms[name]) return rooms[name];
    var p = load().then(function (c) {
      return new Promise(function (ok, bad) {
        var ch = c.channel('conquer:' + name, { config: { broadcast: { self: true, ack: false }, presence: { key: ME } } });
        var room = makeRoom(name, ch), done = false;
        var t = setTimeout(function () { if (!done) { done = true; delete rooms[name]; c.removeChannel(ch); bad(err('upstream_error', 'timeout')); } }, 12000);
        ch.subscribe(function (status) {
          room._status(status);
          if (!done && status === 'SUBSCRIBED') { done = true; clearTimeout(t); ok(freeze(room)); }
          else if (!done && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) { done = true; clearTimeout(t); delete rooms[name]; c.removeChannel(ch); bad(err('upstream_error', status)); }
        });
      });
    });
    rooms[name] = p;
    p.catch(function () { delete rooms[name]; });
    return p;
  }

  var api = freeze({ join: join, connected: function () { return !!client; } });
  window.claude = freeze({ use: function (name) { return Promise.resolve(name === 'room' ? api : null); } });
  window.CONQUER_WEB_ONLINE = true;
})();
