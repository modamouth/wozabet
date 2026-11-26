import { LegalPlaceholder } from '../legal';

export const metadata = { title: 'Terms & Conditions – Wozabet' };

export default function Terms() {
  return <LegalPlaceholder title="Terms & Conditions" sections={[
    'Who we are and our licence', 'Eligibility (18+, Namibian residents)', 'Your account and verification (KYC)', 'Deposits and withdrawals',
    'Placing bets, odds changes and limits', 'Settlement rules (90-minute results, void and cancelled matches)', 'Errors and palpable mistakes',
    'Responsible gambling tools, cool-off and self-exclusion', 'Promotions', 'Account closure and dormant accounts', 'Complaints and disputes', 'Changes to these terms',
  ]} />;
}
