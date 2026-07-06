import { NextRequest, NextResponse } from 'next/server';
import { generateToken } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    // Simple auth - in production use proper user database
    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password required' },
        { status: 400 }
      );
    }

    // Default credentials
    if (username === 'admin' && password === 'legion123') {
      const token = generateToken({
        userId: 'admin-001',
        username: 'admin',
        role: 'admin',
      });

      return NextResponse.json({
        success: true,
        token,
        user: { username: 'admin', role: 'admin' },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid credentials' },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
