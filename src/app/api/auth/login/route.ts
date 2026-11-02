import { NextRequest, NextResponse } from 'next/server';
import { db, comparePassword } from '@/lib/db';
import { createAndStoreOtp } from '@/lib/otp';
import { sendOtpEmail } from '@/lib/email';
import { ApiResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identifier, password } = body;

    if (!identifier || !password) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: 'Username/Phone number and Password are required.',
        },
        { status: 400 }
      );
    }

    // Find user by Username or Phone Number
    const user = db.findByIdentifier(identifier);

    if (!user) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: 'No account found with this Username or Phone number.',
        },
        { status: 404 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: 'This account has been deactivated. Please contact administrator.',
        },
        { status: 403 }
      );
    }

    // Verify Password
    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          message: 'Invalid password. Please check your credentials.',
        },
        { status: 401 }
      );
    }

    // Generate 6-digit OTP strictly valid for 60 seconds
    const otpResult = createAndStoreOtp(user.id, user.email, 60);

    // Send OTP to registered email
    const emailResult = await sendOtpEmail({
      to: user.email,
      otp: otpResult.code,
      username: user.username,
      expirySeconds: 60,
    });

    return NextResponse.json<ApiResponse>({
      success: true,
      message: `Verification code sent to registered email (${otpResult.maskedEmail}). Valid for 60 seconds.`,
      data: {
        userId: user.id,
        email: user.email,
        maskedEmail: otpResult.maskedEmail,
        expirySeconds: 60,
        expiresAt: otpResult.expiresAt,
        // In local dev/testing without SMTP, preview is included so tester is never blocked
        devPreviewOtp: emailResult.preview ? otpResult.code : undefined,
      },
    });
  } catch (error: any) {
    console.error('[API Auth Login Error]:', error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        message: 'Internal server error while processing login.',
        error: error.message,
      },
      { status: 500 }
    );
  }
}

