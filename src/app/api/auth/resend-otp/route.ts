import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createAndStoreOtp } from '@/lib/otp';
import { sendOtpEmail } from '@/lib/email';
import { ApiResponse } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'Email address is required to resend OTP.' },
        { status: 400 }
      );
    }

    const user = db.findByEmail(email);
    if (!user) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'No registered user found with this email.' },
        { status: 404 }
      );
    }

    // Generate fresh OTP with strict 60s validity
    const otpResult = createAndStoreOtp(user.id, user.email, 60);

    const emailResult = await sendOtpEmail({
      to: user.email,
      otp: otpResult.code,
      username: user.username,
      expirySeconds: 60,
    });

    return NextResponse.json<ApiResponse>({
      success: true,
      message: `Fresh verification code sent to ${otpResult.maskedEmail}. Valid for 60 seconds.`,
      data: {
        expirySeconds: 60,
        expiresAt: otpResult.expiresAt,
        devPreviewOtp: emailResult.preview ? otpResult.code : undefined,
      },
    });
  } catch (error: any) {
    console.error('[API Auth Resend OTP Error]:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, message: 'Failed to resend verification code.', error: error.message },
      { status: 500 }
    );
  }
}

