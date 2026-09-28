import { z } from 'zod';
export const keyText = z.string().min(3).max(120).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, underscores and hyphens only');
const safeText = (n) => z.string().trim().max(n);
export const typeText = z.string().trim().min(1).max(32).regex(/^[A-Z0-9 _-]+$/);
export const status = z.enum(['active', 'frozen', 'expired', 'banned', 'disabled']);
export const keyFields = z.object({
  key: keyText.optional(), label: safeText(100).default(''), name: safeText(100).default(''),
  type: typeText.default('PREMIUM'), status: status.default('active'), days: z.number().min(0).max(36500).default(30),
  expiresAt: z.number().int().min(0).max(8640000000000000).optional(), maxDevices: z.number().int().min(1).max(100).default(1),
  prefix: z.string().max(30).regex(/^[A-Za-z0-9_-]*$/).default('Frag'), assignedUser: safeText(100).default(''),
  notes: safeText(4000).default(''), tags: z.array(safeText(40)).max(20).default([]), bindingEnabled: z.boolean().default(true),
  groups: z.number().int().min(1).max(6).default(2), characters: z.number().int().min(4).max(20).default(5),
  separator: z.enum(['-', '_', '']).default('-'), uppercase: z.boolean().default(true), lowercase: z.boolean().default(false), numbers: z.boolean().default(true)
}).strict();
// Zod 4 applies inner defaults through optional fields. Strip create defaults
// explicitly: PATCH must never reset a field that the caller omitted.
export const editFields = z.object(Object.fromEntries(Object.entries(keyFields.shape).map(([name,schema])=>[name,(schema instanceof z.ZodDefault?schema.removeDefault():schema).optional()]))).extend({ version: z.number().int().min(0), adjustHours: z.number().min(-876000).max(876000).optional() }).strict();
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().refine(x => [10,25,50,100].includes(x)).default(25),
  search: safeText(150).default(''), status: z.enum(['','active','frozen','expired','banned','disabled']).default(''), type: safeText(32).default(''),
  sort: z.enum(['createdAt','expiresAt','key','type','status','devices','usageCount','lastUsed','updatedAt']).default('createdAt'),
  direction: z.enum(['asc','desc']).default('desc'), archived: z.enum(['true','false']).default('false'),
  expiration: z.enum(['','lifetime','expired','today','24h','7d','30d','custom']).default(''),
  devices: z.enum(['','none','full','available','custom']).default(''), deviceCount: z.coerce.number().int().min(0).max(100).optional(),
  created: z.enum(['','today','week','month','custom']).default(''), from: z.coerce.number().min(0).optional(), to: z.coerce.number().min(0).optional(),
  expiresFrom: z.coerce.number().min(0).optional(), expiresTo: z.coerce.number().min(0).optional(), tag: safeText(40).default('')
}).strict();
export const actionSchema = z.object({
  action: z.enum(['freeze','unfreeze','disable','enable','revoke','archive','restore','reset-devices','reset-device','disable-device','extend','expire','lifetime','regenerate','duplicate','delete','change-type','change-max','add-tag','remove-tag']),
  value: z.union([z.string().max(120), z.number().finite()]).optional(), confirmation: z.string().max(120).optional()
}).strict();
export const defaultTemplate = '🎉 SUCCESSFUL KEY GENERATION 🎉\n🔑 Key: {key}\n🆓 Key Type: {type}\n⏳ Duration: {duration}\n📱 Maximum Devices: {maxDevices}\n📨 Send Feedback: {contact}\n⚠️ No feedback = Key will be banned.';
export const defaults = {
  title: 'FRAG CONTROL', subtitle: 'Your license system, at a glance.', footer: 'FRAG LICENSE MANAGEMENT', contact: '@Frag_Haxs',
  prefix: 'Frag', type: 'PREMIUM', days: 30, maxDevices: 1, template: defaultTemplate, timezone: 'UTC', dateFormat: 'medium',
  sessionHours: 12, rememberedDays: 14, loginLimit: 8,
  types: ['FREE','PREMIUM','TESTER','VIP','ADMIN TEST','CUSTOM'].map(name => ({ name, badge: '#59e1ec', description: '', days: 30, maxDevices: 1 })), tags: []
};
export const settingsSchema = z.object({
  title: safeText(60).refine(x => x.includes('FRAG')), subtitle: safeText(160), footer: safeText(100), contact: safeText(100),
  prefix: keyFields.shape.prefix, type: typeText, days: keyFields.shape.days, maxDevices: keyFields.shape.maxDevices,
  template: z.string().min(1).max(3000), timezone: z.string().max(100).refine(t => { try { new Intl.DateTimeFormat('en', { timeZone: t }); return true; } catch { return false; } }),
  dateFormat: z.enum(['short','medium','long']), sessionHours: z.number().int().min(1).max(72), rememberedDays: z.number().int().min(1).max(30), loginLimit: z.number().int().min(3).max(20),
  types: z.array(z.object({ name: typeText, badge: z.string().regex(/^#[0-9a-fA-F]{6}$/), description: safeText(200), days: keyFields.shape.days, maxDevices: keyFields.shape.maxDevices }).strict()).min(1).max(30),
  tags: z.array(z.object({ name: safeText(40).min(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict()).max(100)
}).strict();
