import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifySubmittedOtp } from '@/lib/otp';
import { ApiResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, otp } = body;

    if (!email || !otp) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: 'Email and 6-digit OTP code are required.',
        },
        { status: 400 }
      );
    }

    // Verify OTP against 60-second validity window
    const verifyResult = verifySubmittedOtp(email, otp);

    if (!verifyResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: verifyResult.message,
          meta: { isExpired: verifyResult.isExpired },
        },
        { status: verifyResult.isExpired ? 410 : 400 }
      );
    }

    // Find user to build session
    const user = db.findByEmail(email);
    if (!user) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'User record not found.' },
        { status: 404 }
      );
    }

    // Update last login
    db.updateLastLogin(user.id);

    const userSummary = {
      id: user.id,
      username: user.username,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };

    const token = `screpper_${Buffer.from(`${user.id}:${Date.now()}`).toString('base64')}`;

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Authentication successful. Welcome to The screpper!',
      data: {
        user: userSummary,
        token,
      },
    });
  } catch (error: any) {
    console.error('[API Auth Verify OTP Error]:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        message: 'Internal server error verifying OTP.',
        error: error.message,
      },
      { status: 500 }
    );
  }
}

