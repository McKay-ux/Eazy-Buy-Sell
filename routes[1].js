const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { prisma } = require('./db');
const { requireAuth, requireSeller } = require('./middleware/auth');

const router = express.Router();
const countryCodes = ['LS', 'ZA', 'BW', 'SZ', 'NA'];
const currencies = ['LSL', 'ZAR', 'BWP', 'SZL', 'NAD'];
const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(10).max(128),
  phone: z.string().trim().max(30).optional(),
  country: z.enum(countryCodes).default('LS'),
  role: z.enum(['BUYER', 'SELLER']).default('BUYER'),
});
const loginSchema = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(1).max(128) });
const productSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().max(5000).optional().default(''),
  category: z.string().trim().min(2).max(80),
  price: z.coerce.number().positive().max(9999999999),
  currency: z.enum(currencies).default('LSL'),
  stock: z.coerce.number().int().min(0).max(100000).default(1),
  country: z.enum(countryCodes).default('LS'),
  imageUrls: z.array(z.string().url().max(2048)).max(10).default([]),
});

function tokenFor(user) {
  return jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
    subject: user.id, algorithm: 'HS256', expiresIn: '12h', issuer: 'eazybuysell-api', audience: 'eazybuysell-app',
  });
}
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, country: user.country, createdAt: user.createdAt };
}

router.post('/auth/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the registration fields.', details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    const data = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
    if (exists) return res.status(409).json({ error: 'An account with that email already exists.' });
    const { password, ...profile } = data;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { ...profile, passwordHash }, select: { id: true, name: true, email: true, phone: true, role: true, country: true, createdAt: true } });
    return res.status(201).json({ user, token: tokenFor(user), tokenType: 'Bearer', expiresIn: 43200 });
  } catch (err) { next(err); }
});

router.post('/auth/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    return res.json({ user: publicUser(user), token: tokenFor(user), tokenType: 'Bearer', expiresIn: 43200 });
  } catch (err) { next(err); }
});

router.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.get('/products', async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 20));
    const where = { status: 'ACTIVE' };
    if (typeof req.query.country === 'string' && countryCodes.includes(req.query.country)) where.country = req.query.country;
    if (typeof req.query.category === 'string' && req.query.category.length <= 80) where.category = { equals: req.query.category, mode: 'insensitive' };
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const search = req.query.search.trim().slice(0, 100);
      where.OR = [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { category: { contains: search, mode: 'insensitive' } }];
    }
    const [items, total] = await Promise.all([
      prisma.product.findMany({ where, include: { seller: { select: { id: true, name: true, country: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.product.count({ where }),
    ]);
    res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

router.post('/products', requireAuth, requireSeller, async (req, res, next) => {
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the product fields.', details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    const product = await prisma.product.create({ data: { ...parsed.data, sellerId: req.user.id, price: parsed.data.price.toFixed(2) } });
    res.status(201).json({ product });
  } catch (err) { next(err); }
});

router.patch('/products/:id', requireAuth, requireSeller, async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    if (product.sellerId !== req.user.id && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'You can only edit your own listings.' });
    const updateSchema = productSchema.partial().extend({ status: z.enum(['ACTIVE', 'PAUSED', 'SOLD_OUT']).optional() });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the product fields.' });
    const data = { ...parsed.data };
    if (data.price !== undefined) data.price = data.price.toFixed(2);
    res.json({ product: await prisma.product.update({ where: { id: product.id }, data }) });
  } catch (err) { next(err); }
});

const addressSchema = z.object({ label: z.string().trim().min(1).max(50).default('Home'), recipient: z.string().trim().min(2).max(100), phone: z.string().trim().min(5).max(30), line1: z.string().trim().min(2).max(200), line2: z.string().trim().max(200).optional(), town: z.string().trim().min(2).max(100), district: z.string().trim().max(100).optional(), country: z.enum(countryCodes).default('LS'), postalCode: z.string().trim().max(20).optional(), isDefault: z.boolean().default(false) });
router.get('/addresses', requireAuth, async (req, res, next) => {
  try { res.json({ items: await prisma.address.findMany({ where: { userId: req.user.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }) }); } catch (err) { next(err); }
});
router.post('/addresses', requireAuth, async (req, res, next) => {
  try {
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the address fields.', details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    const address = await prisma.$transaction(async tx => {
      if (parsed.data.isDefault) await tx.address.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
      return tx.address.create({ data: { ...parsed.data, userId: req.user.id } });
    });
    res.status(201).json({ address });
  } catch (err) { next(err); }
});
router.delete('/addresses/:id', requireAuth, async (req, res, next) => {
  try {
    const address = await prisma.address.findUnique({ where: { id: req.params.id } });
    if (!address || address.userId !== req.user.id) return res.status(404).json({ error: 'Address not found.' });
    await prisma.address.delete({ where: { id: address.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
