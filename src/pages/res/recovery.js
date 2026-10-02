'use strict';
(() => {
  const { $, el, call, ago } = NX;
  const root = $('#root');
  root.style.maxWidth = '640px';
  call('recovery:info').then((r) => {
    root.replaceChildren(
      el('h1', { style: 'margin:8vh 0 8px' }, 'Nevix recovered your previous session.'),
      el('p', { class: 'dim', style: 'font-size:15px;margin-bottom:18px' }, `The last run didn’t close normally${r.when ? ' (last saved ' + ago(r.when) + ')' : ''}. ${r.tabs} tab${r.tabs === 1 ? '' : 's'} in ${r.windows} window${r.windows === 1 ? '' : 's'}${r.groups ? ' and ' + r.groups + ' group' + (r.groups === 1 ? '' : 's') : ''} can be reopened.`),
      r.crashLoop ? el('div', { class: 'notice danger' }, 'Nevix crashed several times in a row, so experimental flags were turned off automatically. ', el('a', { href: 'nevix://flags' }, 'Review flags')) : null,
      r.sample.length ? el('div', { class: 'list', style: 'margin-bottom:18px' }, r.sample.map((t) => el('div', { class: 'item' }, el('div', { class: 'main' }, el('div', { class: 't' }, t.title), el('div', { class: 'u' }, t.url))))) : null,
      el('div', { class: 'row', style: 'gap:10px' }, el('button', { class: 'btn primary', onclick: () => call('recovery:restore') }, 'Restore Session'), el('button', { class: 'btn', onclick: () => call('recovery:fresh') }, 'Start Fresh')),
      el('p', { class: 'dim', style: 'margin-top:18px;font-size:12.5px' }, 'Restored pages are reloaded from the network, so anything you had typed into a form or an unsaved web document may not come back. Back/forward history and scroll position are restored where possible.'));
  });
})();
