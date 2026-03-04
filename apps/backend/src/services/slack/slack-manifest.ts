type SlackManifestBundle = {
  manifest: Record<string, unknown>;
  yaml: string;
  backendOrigin: string;
  requestUrls: {
    events: string;
    commands: string;
    interactive: string;
    oauthRedirect: string;
  };
  scopes: string[];
  warnings: string[];
};

const DEFAULT_BOT_SCOPES = [
  'channels:read',
  'channels:history',
  'groups:read',
  'groups:history',
  'chat:write',
  'users:read',
  'users:read.email',
  'commands',
];

const DEFAULT_BOT_EVENTS = ['message.channels', 'message.groups', 'message.im', 'message.mpim'];

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function resolveBackendOrigin(): string {
  return safeString(process.env.BACKEND_PUBLIC_ORIGIN || '');
}

function resolveBotScopes(): string[] {
  const raw = safeString(process.env.SLACK_BOT_SCOPES || '');
  if (!raw) return DEFAULT_BOT_SCOPES;
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function resolveBotEvents(): string[] {
  const raw = safeString(process.env.SLACK_BOT_EVENTS || '');
  if (!raw) return DEFAULT_BOT_EVENTS;
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function toYamlQuoted(value: string): string {
  return JSON.stringify(value);
}

function toYamlList(values: string[], indent: number): string {
  const spacing = ' '.repeat(Math.max(0, indent));
  return values.map((value) => `${spacing}- ${toYamlQuoted(value)}`).join('\n');
}

export function buildSlackManifestBundle(): SlackManifestBundle {
  const warnings: string[] = [];
  const backendOrigin = resolveBackendOrigin();
  if (!backendOrigin) {
    warnings.push('BACKEND_PUBLIC_ORIGIN is missing. Manifest URLs use a placeholder value.');
  }

  const origin = backendOrigin || 'https://replace-with-your-backend-origin.example.com';
  const requestUrls = {
    events: `${origin.replace(/\/+$/, '')}/api/slack/events`,
    commands: `${origin.replace(/\/+$/, '')}/api/slack/commands`,
    interactive: `${origin.replace(/\/+$/, '')}/api/slack/interactive`,
    oauthRedirect: `${origin.replace(/\/+$/, '')}/api/slack/oauth/callback`,
  };
  const scopes = resolveBotScopes();
  const botEvents = resolveBotEvents();

  const displayName = safeString(process.env.SLACK_BOT_DISPLAY_NAME || 'BAT');
  const appName = safeString(process.env.SLACK_APP_NAME || 'BAT');
  const appDescription = safeString(
    process.env.SLACK_APP_DESCRIPTION ||
      'BAT assistant for feedback/deadline tracking, owner notifications, and approval-based draft replies.'
  );
  const appBgColor = safeString(process.env.SLACK_APP_BACKGROUND_COLOR || '#1A1F2E');

  const manifest = {
    display_information: {
      name: appName,
      description: appDescription,
      background_color: appBgColor,
    },
    features: {
      bot_user: {
        display_name: displayName,
        always_online: false,
      },
      slash_commands: [
        {
          command: '/bat',
          url: requestUrls.commands,
          description: 'BAT channel linking and backfill command',
          usage_hint: 'link <workspace-id> | backfill',
          should_escape: false,
        },
      ],
    },
    oauth_config: {
      redirect_urls: [requestUrls.oauthRedirect],
      scopes: {
        bot: scopes,
      },
    },
    settings: {
      event_subscriptions: {
        request_url: requestUrls.events,
        bot_events: botEvents,
      },
      interactivity: {
        is_enabled: true,
        request_url: requestUrls.interactive,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };

  const yaml = [
    'display_information:',
    `  name: ${toYamlQuoted(appName)}`,
    `  description: ${toYamlQuoted(appDescription)}`,
    `  background_color: ${toYamlQuoted(appBgColor)}`,
    'features:',
    '  bot_user:',
    `    display_name: ${toYamlQuoted(displayName)}`,
    '    always_online: false',
    '  slash_commands:',
    '    - command: "/bat"',
    `      url: ${toYamlQuoted(requestUrls.commands)}`,
    '      description: "BAT channel linking and backfill command"',
    '      usage_hint: "link <workspace-id> | backfill"',
    '      should_escape: false',
    'oauth_config:',
    '  redirect_urls:',
    toYamlList([requestUrls.oauthRedirect], 4),
    '  scopes:',
    '    bot:',
    toYamlList(scopes, 6),
    'settings:',
    '  event_subscriptions:',
    `    request_url: ${toYamlQuoted(requestUrls.events)}`,
    '    bot_events:',
    toYamlList(botEvents, 6),
    '  interactivity:',
    '    is_enabled: true',
    `    request_url: ${toYamlQuoted(requestUrls.interactive)}`,
    '  org_deploy_enabled: false',
    '  socket_mode_enabled: false',
    '  token_rotation_enabled: false',
    '',
  ].join('\n');

  return {
    manifest,
    yaml,
    backendOrigin,
    requestUrls,
    scopes,
    warnings,
  };
}
