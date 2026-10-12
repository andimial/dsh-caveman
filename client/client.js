/**
 * dsh-caveman browser half: a settings section (toggle + level buttons) and a
 * one-click composer toggle, talking to the host half over /caveman/* routes.
 *
 * BUNDLE FORM: hand-written IIFE registered on window.__ModuleLoader__ — same
 * lazy-CJS factory contract the dsh client module system loads. No imports; the
 * only externals are React and react/jsx-runtime from the loader table.
 *
 * WHY NOT settingsScope: plugin-owned settings namespaces are filtered by the
 * API gateway's WEB allowlist (`settings-not-exposed`). State flows over our
 * own /caveman/status + /caveman/state HTTP routes instead.
 */
window.__ModuleLoader__.load({
  id: 'dsh-caveman',
  factory: function (require) {
    var React = require('react')

    /** Fetch current caveman state from the host half. */
    function fetchState() {
      return fetch('/caveman/status', { cache: 'no-store' }).then(function (res) { return res.json() })
    }

    /** Write partial state; returns the resolved state. */
    function writeState(patch) {
      return fetch('/caveman/state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (res) {
        if (!res.ok) throw new Error('caveman write failed: HTTP ' + res.status)
        return res.json()
      })
    }

    var LEVEL_LABELS = {
      lite: '轻量 lite',
      full: '标准 full',
      ultra: '极限 ultra',
      'wenyan-full': '文言 wenyan',
    }

    // ------------------------------------------------------------------
    // Composer toggle (conversation.input.right): one-click on/off.
    //
    // The slot re-renders its entries whenever the conversation snapshot or
    // the live input state changes (InputZone owner props are point-in-time
    // snapshots), so we piggyback a state refresh on each render instead of
    // holding our own subscription machinery.
    // ------------------------------------------------------------------
    function ComposerToggle() {
      var state = React.useState(null)
      var value = state[0]
      var set = state[1]
      var pending = React.useRef(false)

      if (value === null && !pending.current) {
        pending.current = true
        fetchState().then(function (next) {
          pending.current = false
          set(next)
        }).catch(function () { pending.current = false })
      }

      function toggle() {
        if (value === null) return
        var previous = value
        var next = !value.enabled
        set({ enabled: next, level: value.level })  // optimistic
        // Revert on failure: a rejected write used to leave the button lying
        // about the state (the host answers 403 when the guard refuses).
        writeState({ enabled: next }).then(set).catch(function () { set(previous) })
      }

      var enabled = value !== null && value.enabled
      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: toggle,
          title: enabled ? '输出精简：开启（点击关闭）' : '输出精简：关闭（点击开启）',
          style: {
            border: '1px solid ' + (enabled ? 'var(--dsw-color-success-fg, #1a7f37)' : 'var(--dsw-color-border-strong, #d0d7de)'),
            borderRadius: '6px',
            background: enabled ? 'var(--dsw-color-success-bg, #dafbe1)' : 'transparent',
            color: enabled ? 'var(--dsw-color-success-fg, #1a7f37)' : 'var(--dsw-color-text-secondary, #57606a)',
            fontSize: '12px',
            fontWeight: '600',
            padding: '2px 10px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          },
        },
        enabled ? '精简 ON' : '精简 OFF'
      )
    }

    // ------------------------------------------------------------------
    // Settings section: full control panel.
    // ------------------------------------------------------------------
    function CavemanSection() {
      var state = React.useState(null)
      var value = state[0]
      var set = state[1]
      var busy = React.useState(false)
      var isBusy = busy[0]
      var setBusy = busy[1]
      var failure = React.useState(null)
      var errorText = failure[0]
      var setErrorText = failure[1]

      React.useEffect(function () {
        fetchState().then(set).catch(function () {})
      }, [])

      function apply(patch) {
        setBusy(true)
        setErrorText(null)
        writeState(patch).then(function (next) {
          set(next)
          setBusy(false)
        }).catch(function (error) {
          setBusy(false)
          // Never swallow a rejected write: silence here reads as 「点了没反应」.
          setErrorText(error && error.message ? error.message : String(error))
        })
      }

      if (value === null) {
        return React.createElement('div', { style: { fontSize: '13px', color: 'var(--dsw-color-text-secondary, #57606a)' } }, '加载中…')
      }

      var levelKeys = Object.keys(LEVEL_LABELS)
      var levelButtons = levelKeys.map(function (key) {
        var active = value.level === key && value.enabled
        return React.createElement(
          'button',
          {
            key: key,
            type: 'button',
            disabled: isBusy,
            onClick: function () { apply({ level: key, enabled: true }) },
            className: active ? 'dsw-button dsw-button--primary' : 'dsw-button',
            style: { fontSize: '12px' },
          },
          LEVEL_LABELS[key]
        )
      })

      return React.createElement(
        'section',
        { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        React.createElement(
          'div',
          {
            style: {
              border: '1px solid var(--dsw-color-border-strong, #d0d7de)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            },
          },
          React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-color-text-secondary, #57606a)' } }, '输出精简'),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: isBusy,
                onClick: function () { apply({ enabled: !value.enabled }) },
                className: 'dsw-button' + (value.enabled ? '' : ' dsw-button--primary'),
                style: { minWidth: '88px' },
              },
              value.enabled ? '已开启 — 点击关闭' : '已关闭 — 点击开启'
            )
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-color-text-secondary, #57606a)' } }, '档位'),
            React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, levelButtons)
          ),
          React.createElement(
            'span',
            { style: { fontSize: '12px', color: 'var(--dsw-color-text-secondary, #57606a)' } },
            '开启后注入 system prompt 精简规则；也可在对话里用 /caveman-on、/caveman-off、/caveman-level 切换。修改立即生效，无需重启。'
          ),
          errorText === null ? null : React.createElement(
            'span',
            { style: { fontSize: '12px', color: 'var(--dsw-color-danger-fg, #cf222e)' } },
            '写入失败：' + errorText
          )
        )
      )
    }

    // ------------------------------------------------------------------
    // Registration.
    // ------------------------------------------------------------------
    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'caveman',
            order: 45,
            label: function () { return '输出精简' },
            inject: function () { return {} },
          },
          CavemanSection
        )
      })

      ctx.slots.inject('conversation.input.right', function () {
        return ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'caveman-toggle',
            order: 90,
            label: function () { return '输出精简开关' },
            inject: function () { return {} },
          },
          ComposerToggle
        )
      })
    }

    return { name: 'dsh-caveman', inject: inject, apply: apply }
  },
})
