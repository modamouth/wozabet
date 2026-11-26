import { LegalPlaceholder } from '../legal';

export const metadata = { title: 'Privacy Policy – Wozabet' };

export default function Privacy() {
  return <LegalPlaceholder title="Privacy Policy" sections={[
    'Who is responsible for your data', 'What we collect (account, ID documents, phone, betting and payment records)', 'Why we use it (licence, anti-money-laundering, fraud, responsible gambling)',
    'Who we share it with (payment and SMS providers, regulators)', 'How long we keep it', 'How we protect it', 'Your rights', 'Contact us',
  ]} />;
}
