import { notFound } from 'next/navigation';
import PlaylistPreview from '../../components/PlaylistPreview';

export const dynamic = 'force-dynamic';

export default function PlaylistPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PlaylistPreview />;
}
