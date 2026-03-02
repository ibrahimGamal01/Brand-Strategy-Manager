# Day 0 - AWS Access and Security Tracker

Last updated: 2026-03-02 (Africa/Cairo)

## Current Status

- [x] AWS CLI installed locally
- [ ] AWS credentials configured (`aws login` or access keys)
- [ ] Caller identity verified (`aws sts get-caller-identity`)
- [ ] Billing budget alerts configured
- [ ] Root account MFA enabled
- [ ] Admin IAM role confirmed for daily use
- [ ] CI deploy role/user created (least privilege)
- [ ] Domain/DNS ownership confirmed

## Local Verification Output

```bash
aws --version
# aws-cli/2.34.0 Python/3.13.12 Darwin/25.2.0 source/arm64

aws sts get-caller-identity --output json
# ERROR: NoCredentials (credentials not configured yet)
```

## Next Commands (Run in Order)

If using IAM Identity Center (recommended):

```bash
aws configure sso
aws sso login --profile <your-profile-name>
aws sts get-caller-identity --profile <your-profile-name> --output json
```

If using access keys:

```bash
aws configure
aws sts get-caller-identity --output json
```

## Record Once Auth Works

- AWS Account ID:
- IAM role/user used for daily operations:
- Active CLI profile name:
- Budget alert email recipients:
- Domain name for production:
