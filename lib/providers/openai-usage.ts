import { fieldNames, ProviderFailure, type Usage } from './adapter';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
// Responses usage, strict like every other parser: input and output must add up to the total, and reasoning is part
// of output, reported only as a count. A shape it does not know fails closed with the names it carried, never values.
export function openAIUsage(raw: unknown, response: unknown): Usage {
  if (!record(raw)) throw new ProviderFailure('upstream', fieldNames(response));
  const unparsed = (): never => { throw new ProviderFailure('upstream', fieldNames(raw)); };
  const { input_tokens: prompt, output_tokens: completion, total_tokens: total, output_tokens_details: details } = raw;
  if (!count(prompt) || !count(completion) || !count(total) || prompt + completion !== total) return unparsed();
  if (details === undefined) return { prompt, completion, total };
  if (!record(details)) return unparsed();
  const reasoning = details.reasoning_tokens;
  if (reasoning === undefined) return { prompt, completion, total };
  if (!count(reasoning) || reasoning > completion) return unparsed();
  return { prompt, completion, total, reasoning };
}
