import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ToolDeps } from './deps.js';
import { errorMessage, toolError, toolText } from './helpers.js';

const inputSchema = {
  question: z.string().min(1).max(300).describe('The poll question, max 300 chars.'),
  options: z
    .array(z.string().min(1).max(100))
    .min(2)
    .max(10)
    .describe('2–10 answer options, max 100 chars each.'),
  allows_multiple_answers: z.boolean().default(false).describe('Let voters pick several options.'),
  quiz_correct_option_index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Set to make it a quiz: 0-based index of the correct option (reveals right/wrong on vote).'),
  silent: z.boolean().default(false).describe('Post without notifying subscribers.')
};

export function registerPostPoll(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'post_poll',
    {
      title: 'Post a poll to Telegram channel',
      description:
        `Publish a native Telegram poll (or quiz) to ${deps.channelId}. Polls in channels are ` +
        'always anonymous. Returns the message ID and link.',
      inputSchema
    },
    async ({ question, options, allows_multiple_answers, quiz_correct_option_index, silent }) => {
      if (quiz_correct_option_index !== undefined && quiz_correct_option_index >= options.length) {
        return toolError(
          `quiz_correct_option_index ${quiz_correct_option_index} is out of range for ${options.length} options.`
        );
      }
      try {
        const sent = await deps.telegram.sendPoll({
          chatId: deps.channelId,
          question,
          options,
          allowsMultipleAnswers: allows_multiple_answers,
          quizCorrectOptionIndex: quiz_correct_option_index,
          silent
        });
        await deps.registry.record({
          messageId: sent.messageId,
          kind: 'poll',
          content: `${question} [${options.join(' / ')}]`,
          link: sent.link
        });
        deps.logger.info('post_poll succeeded', { messageId: sent.messageId });
        const link = sent.link !== undefined ? ` Link: ${sent.link}` : '';
        return toolText(`Posted poll to ${deps.channelId}: message_id ${sent.messageId}.${link}`);
      } catch (error) {
        deps.logger.error('post_poll failed', { message: errorMessage(error) });
        return toolError(`Failed to post poll to ${deps.channelId}: ${errorMessage(error)}`);
      }
    }
  );
}
