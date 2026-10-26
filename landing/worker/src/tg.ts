/** Вызовы Telegram Bot API. */
export type Button = { text: string; callback_data?: string; url?: string }
export type Keyboard = Button[][]

export interface TelegramApi {
  token: string
  call(method: string, params: Record<string, unknown>): Promise<unknown>
  send(chatId: number, text: string, buttons?: Keyboard): Promise<number | null>
  edit(chatId: number, messageId: number, text: string, buttons?: Keyboard): Promise<boolean>
  answer(callbackId: string, text?: string | null): Promise<void>
}

export class Telegram implements TelegramApi {
  constructor(
    public token: string,
    private api = 'https://api.telegram.org',
  ) {}

  /** Результат метода или null при ошибке (ошибка пишется в лог). */
  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.token) return null
    try {
      const res = await fetch(`${this.api}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string }
      if (!data.ok) {
        console.warn(`Telegram ${method}: ${data.description}`)
        return null
      }
      return data.result
    } catch (err) {
      console.warn(`Telegram ${method}: ${err}`)
      return null
    }
  }

  async send(chatId: number, text: string, buttons?: Keyboard): Promise<number | null> {
    const res = (await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    })) as { message_id: number } | null
    return res?.message_id ?? null
  }

  async edit(chatId: number, messageId: number, text: string, buttons?: Keyboard): Promise<boolean> {
    const res = await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons ?? [] },
    })
    return res !== null
  }

  async answer(callbackId: string, text?: string | null): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) })
  }
}

/** Секрет вебхука: Telegram присылает его в заголовке, так чужие запросы не пройдут. */
export async function webhookSecret(token: string): Promise<string> {
  return (await sha256(`vaag-webhook:${token}`)).slice(0, 48)
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
