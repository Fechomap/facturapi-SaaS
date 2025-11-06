/**
 * Telegram Bot-related types and interfaces
 */

import { Context, Telegraf } from 'telegraf';

/**
 * Extended Telegram Context with session and tenant data
 */
export interface BotContext extends Context {
  match?: RegExpExecArray;
  session?: {
    step?: string;
    data?: Record<string, unknown>;
    tenant?: {
      id: string;
      name: string;
      apiKey: string;
    };
    facturaId?: string;
    series?: string;
    folioFactura?: number | string;
    facturaGenerada?: boolean;
    pdfAnalysis?: any;
  };
  tenant?: {
    id: string;
    name: string;
    apiKey: string;
    organizationId: string;
  };
  userState?: any;
  clientIds?: Record<string, string>;
  clientNameMap?: Record<string, string>;

  // Helper methods
  getTenantId(): string;
  hasTenant(): boolean;
  isUserAuthorized?(): boolean;
  isProcessActive(processId: string): boolean;
  markProcessActive(processId: string): void;
  markProcessInactive(processId: string): void;
  resetState(): void;
  reloadSession?(): Promise<void>;
  saveSession?(): Promise<void>;

  // Multi-auth helper methods
  getUserRole?(): string;
  hasPermission?(permission: string): boolean;
  isAdmin?(): boolean;
}

/**
 * Bot command handler
 */
export type BotCommandHandler = (ctx: BotContext) => Promise<void>;

/**
 * Bot middleware
 */
export type BotMiddleware = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;

/**
 * Bot instance type
 */
export type Bot = Telegraf<BotContext>;

/**
 * Conversation step
 */
export interface ConversationStep {
  name: string;
  message: string;
  validate?: (input: string) => boolean | Promise<boolean>;
  parse?: (input: string) => unknown;
  next?: string | ((data: Record<string, unknown>) => string);
}

/**
 * Invoice creation wizard data
 */
export interface InvoiceWizardData {
  customerName?: string;
  taxId?: string;
  email?: string;
  description?: string;
  amount?: number;
  quantity?: number;
  paymentForm?: string;
  productKey?: string;
}

/**
 * Client creation wizard data
 */
export interface ClientWizardData {
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  zip?: string;
}

/**
 * Keyboard button configuration
 */
export interface KeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/**
 * Inline keyboard configuration
 */
export interface InlineKeyboard {
  inline_keyboard: KeyboardButton[][];
}

/**
 * File upload data
 */
export interface FileUpload {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Bot notification
 */
export interface BotNotification {
  chatId: number;
  message: string;
  options?: {
    parse_mode?: 'Markdown' | 'HTML';
    reply_markup?: InlineKeyboard;
    disable_notification?: boolean;
  };
}
