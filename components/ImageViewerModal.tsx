/**
 * Native implementation — delegates to react-native-image-viewing
 * which provides pinch-zoom and swipe-to-close.
 *
 * The .web.tsx sibling is picked automatically by Metro/Webpack for web
 * builds, so this file (and the react-native-image-viewing import) never
 * reaches the web bundle.
 */
import ImageViewing from 'react-native-image-viewing';

export interface ImageViewerModalProps {
  images: { uri: string }[];
  imageIndex: number;
  visible: boolean;
  onRequestClose: () => void;
}

export default function ImageViewerModal({
  images,
  imageIndex,
  visible,
  onRequestClose,
}: ImageViewerModalProps) {
  return (
    <ImageViewing
      images={images}
      imageIndex={imageIndex}
      visible={visible}
      onRequestClose={onRequestClose}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
    />
  );
}
