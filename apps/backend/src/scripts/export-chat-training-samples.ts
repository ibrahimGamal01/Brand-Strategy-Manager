import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';

type ExportSample = {
  researchJobId: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  createdAt: string;
  prompt: string;
  response: {
    content: string;
    blocks: unknown;
    followUp: unknown;
    designOptions: unknown;
  };
  feedback: {
    pinnedBlockIds: string[];
    selectedDesignIds: string[];
    formAnswers: string[];
  };
};

function ensureDir(targetPath: string) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

async function main() {
  const maxSessions = Math.max(1, Number(process.env.CHAT_EXPORT_MAX_SESSIONS || 500));
  const defaultOutput = path.join(
    process.cwd(),
    'storage',
    'exports',
    `chat-training-${Date.now()}.jsonl`
  );
  const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultOutput;

  const sessions = await prisma.chatSession.findMany({
    take: maxSessions,
    orderBy: { lastActiveAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
      blockEvents: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const lines: string[] = [];

  for (const session of sessions) {
    const messages = session.messages;
    for (let i = 0; i < messages.length; i += 1) {
      const userMessage = messages[i];
      if (userMessage.role !== 'USER') continue;

      const assistantMessage = messages
        .slice(i + 1)
        .find((message) => message.role === 'ASSISTANT');
      if (!assistantMessage) continue;

      const events = session.blockEvents.filter((event) => event.messageId === assistantMessage.id);
      const pinnedBlockIds = events
        .filter((event) => event.eventType === 'PIN')
        .map((event) => event.blockId);
      const selectedDesignIds = events
        .filter((event) => event.eventType === 'SELECT_DESIGN')
        .map((event) => {
          const payload = (event.payload || {}) as Record<string, unknown>;
          return String(payload.designId || event.blockId || '').trim();
        })
        .filter(Boolean);
      const formAnswers = events
        .filter((event) => event.eventType === 'FORM_SUBMIT')
        .map((event) => {
          const payload = (event.payload || {}) as Record<string, unknown>;
          return String(payload.answer || '').trim();
        })
        .filter(Boolean);

      const sample: ExportSample = {
        researchJobId: session.researchJobId,
        sessionId: session.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        createdAt: toIso(assistantMessage.createdAt),
        prompt: userMessage.content,
        response: {
          content: assistantMessage.content,
          blocks: assistantMessage.blocks,
          followUp: assistantMessage.followUp,
          designOptions: assistantMessage.designOptions,
        },
        feedback: {
          pinnedBlockIds,
          selectedDesignIds,
          formAnswers,
        },
      };

      lines.push(JSON.stringify(sample));
    }
  }

  ensureDir(outputPath);
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(`Exported ${lines.length} chat training samples`);
  console.log(`Output: ${outputPath}`);
}

main()
  .catch((error) => {
    console.error('[ExportChatTraining] failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
