/* Watch Party — the lineup editor for one game: who played (or was away), each player's position for that game,
   guest players (affiliates / call-ups), and copying the last game's lineup. Used on the New game form and the game screen. */
App.ready.then(() => {
  'use strict';
  const {
    $, S, el, toast
  } = App;

  const guestOpen = new Set(); // containers with the "add guest" form open

  /**
   * renderLineup(box, { lineup, onChange(newLineup), gameId, idPrefix })
   * Draws the editor into box. Every change calls onChange with a fresh lineup object.
   */
  function renderLineup(box, o) {
    const roster = S.settings.roster;
    const lineup = WP.normalizeLineup(o.lineup);
    const rows = WP.gameLineup({ lineup }, roster);
    const pfx = o.idPrefix || 'lu';
    const set = (L) => o.onChange(WP.normalizeLineup(L));
    if (!roster.length && !lineup.guests.length) {
      box.replaceChildren(el('span', { class: 'small muted' }, 'Add players on the ', el('a', { href: '#team/roster' }, 'Team page'), ' to set who played in each game.'));
      return;
    }
    const playing = rows.filter((r) => !r.away).length;
    const away = rows.length - playing;
    const posSelect = (r) => {
      const sel = el('select', { 'aria-label': 'Position for #' + r.number + ' this game', class: r.guest || r.pos === r.primary || !r.primary ? '' : 'changed',
        onchange: (e) => set(WP.setGamePos(lineup, r.number, e.target.value, r.primary)) },
      el('option', { value: '' }, '—'), ...WP.POSITIONS.map(([c, n]) => el('option', { value: c, title: n }, c)));
      sel.value = r.pos || '';
      return sel;
    };
    const items = rows.map((r) => {
      const who = '#' + r.number + (r.name ? ' ' + r.name : '');
      const li = el('li', { class: 'lurow' + (r.away ? ' away' : '') },
        el('span', { class: 'jersey' + (r.guest ? ' guest' : '') }, r.number),
        el('span', { class: 'grow stack', style: 'gap:0' }, el('span', { style: 'font-weight:600' }, r.name || (r.guest ? 'Guest' : 'No name')),
          r.guest ? el('span', { class: 'small note' }, 'Guest · this game only')
            : (!r.away && r.primary && r.pos && r.pos !== r.primary) ? el('span', { class: 'small note' }, 'Playing ' + r.pos + ' this game (usually ' + r.primary + ')') : ''),
        r.away ? '' : posSelect(r),
        r.guest
          ? el('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove guest ' + who, onclick: () => set(WP.removeGuest(lineup, r.number)) }, 'Remove')
          : el('button', { type: 'button', class: 'btn small ' + (r.away ? 'awaybtn' : 'playbtn'), 'aria-pressed': String(!r.away), 'aria-label': who + (r.away ? ' is away' : ' is playing') + ' — tap to change',
            onclick: () => set(WP.setAway(lineup, r.number, !r.away)) }, r.away ? 'Away' : 'Playing'));
      return li;
    });
    const prev = WP.lastLineup(S.games, o.gameId);
    const guestForm = guestOpen.has(pfx)
      ? el('form', { class: 'row', style: 'align-items:flex-end', onsubmit: (e) => {
        e.preventDefault();
        try {
          set(WP.addGuest(lineup, roster, $(pfx + '-gnum').value, $(pfx + '-gname').value, $(pfx + '-gpos').value));
          guestOpen.delete(pfx);
        } catch (err) { toast(err.message, { err: true }); }
      } },
      el('label', { class: 'field', style: 'width:80px' }, 'Number', el('input', { type: 'text', id: pfx + '-gnum', inputmode: 'numeric', autocomplete: 'off' })),
      el('label', { class: 'field', style: 'flex:1 1 140px' }, 'Name (optional)', el('input', { type: 'text', id: pfx + '-gname', autocomplete: 'off' })),
      el('label', { class: 'field', style: 'width:110px' }, 'Position', el('select', { id: pfx + '-gpos' }, el('option', { value: '' }, '—'), ...WP.POSITIONS.map(([c]) => el('option', { value: c }, c)))),
      el('button', { type: 'submit', class: 'btn small primary' }, 'Add guest'),
      el('button', { type: 'button', class: 'btn small', onclick: () => { guestOpen.delete(pfx); renderLineup(box, o); } }, 'Cancel'))
      : '';
    box.replaceChildren(
      !o.title ? '' : el('div', { class: 'row spread' },
        el('h3', {}, o.title),
        el('span', { class: 'small muted', id: pfx + '-sum' }, playing + ' playing' + (away ? ' · ' + away + ' away' : '') + (lineup.guests.length ? ' · ' + lineup.guests.length + ' guest' + (lineup.guests.length === 1 ? '' : 's') : ''))),
      el('ul', { class: 'lulist' }, ...items),
      guestForm,
      el('div', { class: 'row' },
        guestOpen.has(pfx) ? '' : el('button', { type: 'button', class: 'btn small outline', onclick: () => { guestOpen.add(pfx); renderLineup(box, o); setTimeout(() => { const n = $(pfx + '-gnum'); if (n) n.focus(); }, 0); } }, '+ Guest player'),
        prev ? el('button', { type: 'button', class: 'btn small outline', onclick: () => { set(prev); toast('Copied the last game’s lineup'); } }, 'Copy last game’s lineup') : '',
        el('span', { class: 'small muted grow' }, 'Players who were away drop out of the list when you tag players on a clip.')));
  }

  function lineupSummary(game) {
    const rows = WP.gameLineup(game, S.settings.roster);
    if (!rows.length) return '';
    const p = rows.filter((r) => !r.away).length;
    return p + ' playing' + (rows.length - p ? ' · ' + (rows.length - p) + ' away' : '');
  }

  Object.assign(App, {
    renderLineup, lineupSummary
  });
}).catch((e) => setTimeout(() => { throw e; }));
