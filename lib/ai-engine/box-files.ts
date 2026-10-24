/**
 * Files the box agent may install on a Windows box (ai_box_files). Only the
 * JICATE worker; the agent never updates itself. Keep in step with the CHECK
 * on ai_box_files.name and with FILES in jicate-box-agent.mjs.
 */
export const BOX_FILES = ['jicate-ai-drain.mjs'] as const;
export type BoxFileName = (typeof BOX_FILES)[number];

export function isBoxFile(name: string): name is BoxFileName {
  return (BOX_FILES as readonly string[]).includes(name);
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
