/**
 * Files the box agent may install on a Windows box (ai_box_files): the JICATE
 * worker, the agent itself (staged as .new; its launcher swaps it), the mail
 * client, the two .cmd launchers and the task XMLs used by register-task.
 * Keep in step with the CHECK on ai_box_files.name
 * (20261024_box_remote_control.sql), FILES in sign-box-file.mjs and the
 * agent's own list in jicate-box-agent.mjs.
 */
export const BOX_FILES = [
  'jicate-ai-drain.mjs',
  'jicate-box-agent.mjs',
  'jicate-mail.mjs',
  'run-jicate-ai-drain.cmd',
  'run-jicate-box-agent.cmd',
  'ai.jicate.engine-1.xml',
  'ai.jicate.engine-2.xml',
  'ai.jicate.engine-3.xml',
  'ai.jicate.engine-4.xml',
  'ai.jicate.box-agent.xml'
] as const;
export type BoxFileName = (typeof BOX_FILES)[number];

export function isBoxFile(name: string): name is BoxFileName {
  return (BOX_FILES as readonly string[]).includes(name);
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
