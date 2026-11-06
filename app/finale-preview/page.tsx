import { notFound } from 'next/navigation';
import FinalePreview from '../../components/FinalePreview';

export const dynamic = 'force-dynamic';

export default function FinalePreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <FinalePreview />;
}
