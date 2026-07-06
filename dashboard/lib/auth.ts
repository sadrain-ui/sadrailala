import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const SECRET_KEY = process.env.JWT_SECRET || 'legion-secret-key-change-in-production';

export interface TokenPayload {
  userId: string;
  username: string;
  role: 'admin' | 'user';
  iat?: number;
  exp?: number;
}

export function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, SECRET_KEY, { expiresIn: '24h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET_KEY) as TokenPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}

export function createAuthResponse(status: number, message: string) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

// Middleware to protect endpoints
export async function withAuth(
  request: NextRequest,
  handler: (request: NextRequest, user: TokenPayload) => Promise<NextResponse>
): Promise<NextResponse> {
  const token = getTokenFromRequest(request);

  if (!token) {
    return createAuthResponse(401, 'Missing or invalid authorization token');
  }

  const user = verifyToken(token);
  if (!user) {
    return createAuthResponse(401, 'Invalid or expired token');
  }

  return handler(request, user);
}
