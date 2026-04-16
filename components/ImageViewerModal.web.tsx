/**
 * Web implementation — uses a standard Modal + ScrollView so the app
 * doesn't crash on React Native Web (react-native-image-viewing is
 * native-only and must never be imported in a web bundle).
 */
import {
  Modal,
  View,
  Image,
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import type { ImageViewerModalProps } from './ImageViewerModal';

const SCREEN = Dimensions.get('window');

export default function ImageViewerModal({
  images,
  imageIndex,
  visible,
  onRequestClose,
}: ImageViewerModalProps) {
  const [idx, setIdx] = useState(imageIndex);

  // Reset to the requested index whenever the viewer opens
  useEffect(() => {
    if (visible) setIdx(imageIndex);
  }, [visible, imageIndex]);

  const uri     = images[idx]?.uri ?? '';
  const hasPrev = idx > 0;
  const hasNext = idx < images.length - 1;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onRequestClose} activeOpacity={0.8}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>

        {/* Counter (only when multiple images) */}
        {images.length > 1 && (
          <Text style={styles.counter}>{idx + 1} / {images.length}</Text>
        )}

        {/* Zoomable image */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          {uri ? (
            <Image source={{ uri }} style={styles.image} resizeMode="contain" />
          ) : null}
        </ScrollView>

        {/* Prev / Next arrows */}
        {hasPrev && (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnLeft]}
            onPress={() => setIdx(i => i - 1)}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-forward" size={32} color="#fff" />
          </TouchableOpacity>
        )}
        {hasNext && (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnRight]}
            onPress={() => setIdx(i => i + 1)}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back" size={32} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  closeBtn: {
    position: 'absolute',
    top: 52,
    left: 16,
    zIndex: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 22,
    padding: 8,
  },
  counter: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    zIndex: 10,
  },
  scrollContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: SCREEN.width,
    height: SCREEN.height,
  },
  navBtn: {
    position: 'absolute',
    top: SCREEN.height / 2 - 28,
    zIndex: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
    padding: 8,
  },
  navBtnLeft:  { left: 16 },
  navBtnRight: { right: 16 },
});
