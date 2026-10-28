// 单元测试：抽出 index.html 里的本地演示引擎，在 Node 里跑一遍完整业务链路
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const from = script.indexOf('const DEMO = {');
const to = script.indexOf('/* 进入演示模式');
if (from < 0 || to < 0) { console.error('❌ 未找到切片标记'); process.exit(1); }
const slice = script.slice(from, to);

// ---- 环境桩 ----
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
let me = null, offline = false, DEMO_MODE = false;
global.showToast = () => { };

const ctx = { me: null };
const code = `
let me = null, offline = false, DEMO_MODE = false;
${slice}
return { LOCAL, getMe: () => me, setMe: v => { me = v; } };
`;
const factory = new Function(code);
const M = factory();

const J = o => JSON.stringify(o);
function ok(cond, label, extra) {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const LOCAL = M.LOCAL;

  // 0) 未登录时受保护接口应要求登录
  let r = LOCAL.api('/api/bootstrap');
  ok(r.ok && r.me === null, 'bootstrap 未登录返回 ok 且 me=null', `events=${r.events.length}`);

  r = LOCAL.api('/api/events', { method: 'POST', body: J({ title: 'x' }) });
  ok(r.needLogin === true, '未登录发布演出被拦截');

  // 1) 模拟登录（等价于 login.html 写入本地账户）
  const user = {
    id: 51234, nickname: '乐遇同学1234', avatar: '🎧', signature: '', school: '原力大学', city: '原力城市',
    uid: 'T001234', phone_masked: '139****1234', created_at: new Date().toISOString(),
  };
  localStorage.setItem('sf_token', 'demo-local');
  localStorage.setItem('sf_user', J(user));
  M.setMe(user);

  r = LOCAL.api('/api/bootstrap');
  ok(r.ok && r.me && r.me.nickname === '乐遇同学1234', '登录后 bootstrap 返回本人');

  // 2) 发布演出
  const before = r.events.length;
  let d = LOCAL.api('/api/events', { method: 'POST', body: J({ title: '测试巡演·原力站', month: 'DEC', date: '20', genre: '摇滚', venue: '原力体育馆', ticket: '180', emoji: '🎸' }) });
  ok(d.ok && d.event.mine === true, '发布演出成功且标记为本人发布', d.event && d.event.title);
  const evId = d.event.id;

  // 3) 想去 / 取消想去
  d = LOCAL.api(`/api/events/${evId}/want`, { method: 'POST' });
  ok(d.ok && d.wanted === false, '再次点击取消「想去」', `want=${d.want}`);
  d = LOCAL.api(`/api/events/${evId}/want`, { method: 'POST' });
  ok(d.ok && d.wanted === true, '重新加入「想去」', `want=${d.want}`);
  r = LOCAL.api('/api/bootstrap');
  ok(r.events.length === before + 1, '新演出已持久化进列表', `${before} → ${r.events.length}`);

  // 4) 发布搭子帖 + 举爪
  d = LOCAL.api('/api/posts', { method: 'POST', body: J({ note: '测试招搭子一起冲', ev: '测试巡演·原力站', count: '2 人', school: '原力大学', tags: ['拼车'] }) });
  ok(d.ok && d.post.mine === true, '发布搭子招募成功', `id=${d.post.id}`);
  const postId = d.post.id;
  d = LOCAL.api(`/api/posts/${postId}/paw`, { method: 'POST' });
  ok(d.ok, '举爪报名成功');

  // 5) 创建自己的应援墙（自动入墙 + 自动首帖）
  d = LOCAL.api('/api/walls', { method: 'POST', body: J({ name: '测试·林测试', emoji: '🎤', slogan: '测试应援口号' }) });
  ok(d.ok && d.wall.mine === true, '创建应援墙成功', d.wall && d.wall.name);
  const wallId = d.wall.id;
  d = LOCAL.api('/api/walls', { method: 'POST', body: J({ name: '测试·林测试' }) });
  ok(d.ok === false, '同名应援墙被去重拦截');

  // 6) 墙详情
  d = LOCAL.api(`/api/walls/${wallId}`);
  ok(d.ok && d.joined === true && d.mine === true, '墙详情：本人已加入 + 本人创建');
  ok(d.posts.length >= 3, '墙详情含建墙宣言 + 示例应援', `posts=${d.posts.length}`);
  ok(d.members.length >= 4, '墙详情含墙友列表', `members=${d.members.length}`);

  // 7) 墙内发帖 + 点赞
  d = LOCAL.api(`/api/walls/${wallId}/posts`, { method: 'POST', body: J({ content: '全链路测试动态 🎉' }) });
  ok(d.ok, '墙内发布应援动态成功');
  const wpId = d.post.id;
  d = LOCAL.api(`/api/wall-posts/${wpId}/like`, { method: 'POST' });
  ok(d.ok && d.liked === true && d.likes === 1, '点赞应援动态', `likes=${d.likes}`);
  d = LOCAL.api(`/api/wall-posts/${wpId}/like`, { method: 'POST' });
  ok(d.ok && d.liked === false && d.likes === 0, '再次点赞取消', `likes=${d.likes}`);

  // 8) 加入别人的墙
  r = LOCAL.api('/api/bootstrap');
  const other = r.walls.find(w => !w.mine);
  const fansBefore = other.fans;
  d = LOCAL.api(`/api/walls/${other.id}/join`, { method: 'POST' });
  ok(d.ok && d.fans === fansBefore + 1, '加入别人的应援墙，粉丝 +1', `${fansBefore} → ${d.fans}`);

  // 9) 我的页数据
  d = LOCAL.api('/api/me/profile');
  ok(d.ok && d.user.nickname === '乐遇同学1234', '我的页：用户信息正确');
  ok(d.stats.likes >= 0 && d.stats.buddies === 1, '我的页：统计数字计算正确', J(d.stats));
  ok(d.works.some(w => w.type === 'post') && d.works.some(w => w.type === 'wall'), '我的页：作品含搭子帖 + 应援墙', `works=${d.works.length}`);

  // 10) 改资料
  d = LOCAL.api('/api/me/profile', { method: 'POST', body: J({ nickname: '改过的名字', signature: '新签名', school: '测试大学', city: '测试市', avatar: '🎶' }) });
  ok(d.ok && d.user.nickname === '改过的名字' && d.user.avatar === '🎶', '改昵称/签名/学校/城市/头像成功');
  ok(JSON.parse(localStorage.getItem('sf_user')).nickname === '改过的名字', '资料已写入本地存储并持久化');

  // 11) 消息中心
  d = LOCAL.api('/api/messages');
  ok(d.ok && d.list.length >= 1 && d.unread >= 1, '消息中心收到通知', `unread=${d.unread}`);
  d = LOCAL.api('/api/messages/read', { method: 'POST' });
  ok(d.ok, '标记全部已读成功');
  d = LOCAL.api('/api/messages');
  ok(d.unread === 0, '未读数归零');

  // 12) 模拟刷新：重建引擎，数据应仍在
  LOCAL._db = null;
  r = LOCAL.api('/api/bootstrap');
  ok(r.events.some(e => e.id === evId), '刷新后新增演出仍在（localStorage 持久化）');
  ok(r.walls.some(w => w.id === wallId), '刷新后新建应援墙仍在');

  // 13) 退出登录
  LOCAL.api('/api/auth/logout', { method: 'POST' });
  r = LOCAL.api('/api/bootstrap');
  ok(r.me === null, '退出登录后 me 清空');

  console.log('\n——— 本地演示引擎链路测试结束 ———');
})();
