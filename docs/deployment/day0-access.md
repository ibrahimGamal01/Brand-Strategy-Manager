# Day 0 - AWS Production Foundation Tracker (10k Customers/Month)

Last updated: 2026-03-02 (Africa/Cairo)

Day 0 in this project means creating a proper AWS foundation for scale, security, and operations before deployment.

## Day 0 Goal

By end of Day 0, you should have:

- a production-ready AWS account structure,
- security and billing guardrails enabled,
- baseline network and DNS readiness,
- required quota requests submitted,
- authenticated CLI access with non-root identity.

## Track Progress

### A. Account and Org Structure

- [ ] Choose account strategy:
- [ ] Recommended now: 2-account minimum (`management`, `production`)
- [ ] Preferred target: 3-account (`management`, `production`, `staging`)
- [ ] Create production account and verify owner email access
- [ ] Enable AWS Support plan (Business is recommended for production operations)

### B. Identity and Security Baseline

- [ ] Root MFA enabled and root access keys deleted
- [ ] IAM Identity Center enabled
- [ ] Admin role created for daily operations (no daily root usage)
- [ ] Break-glass emergency role created and documented
- [ ] CloudTrail enabled in all regions and writing to encrypted S3
- [ ] GuardDuty enabled
- [ ] Security Hub enabled
- [ ] AWS Config enabled (at least in production region)

### C. Billing and Cost Controls

- [ ] Monthly budget created with alert thresholds (50%, 80%, 100%)
- [ ] AWS Cost Anomaly Detection enabled
- [ ] Billing alerts delivered to at least two emails/slack channel
- [ ] Cost allocation tags policy defined (`env`, `service`, `owner`, `cost_center`)

### D. Region and Quota Readiness

- [ ] Primary region selected (default for this repo: `us-east-1`)
- [ ] Backup region selected (disaster recovery target)
- [ ] Service quota review completed for:
- [ ] ECS/Fargate task capacity
- [ ] Application Load Balancers and target groups
- [ ] RDS instance classes and storage
- [ ] ElastiCache node family limits
- [ ] ECR repositories/image pull throughput
- [ ] Quota increase requests submitted for expected 6-month demand

### E. Network and DNS Foundation

- [ ] Production VPC created across 3 AZs
- [ ] Public and private subnets created in each AZ
- [ ] NAT strategy decided (cost-aware)
- [ ] Security groups and NACL baseline created
- [ ] Route53 hosted zone created or external DNS integrated
- [ ] ACM certificates requested for app/API domains

### F. Access and Automation

- [x] AWS CLI installed locally
- [ ] AWS credentials configured (`aws configure sso` recommended)
- [ ] Caller identity verified (`aws sts get-caller-identity`)
- [ ] CI deploy role created with least privilege

## Local Verification Output (Current)

```bash
aws --version
# aws-cli/2.34.0 Python/3.13.12 Darwin/25.2.0 source/arm64

aws sts get-caller-identity --output json
# ERROR: NoCredentials (credentials not configured yet)
```

## First Commands to Unblock Day 0

Recommended (IAM Identity Center / SSO):

```bash
aws configure sso
aws sso login --profile <your-profile-name>
aws sts get-caller-identity --profile <your-profile-name> --output json
```

Fallback (access keys, less preferred):

```bash
aws configure
aws sts get-caller-identity --output json
```

## Record Day 0 Outputs

- Organization / account strategy selected:
- Management account ID:
- Production account ID:
- Primary region:
- Backup region:
- Admin role name:
- Break-glass role name:
- Active CLI profile:
- Budget alert recipients:
- Domain name(s):
