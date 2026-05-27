import { motion, Variants } from 'framer-motion';
import { useEffect } from 'react';

interface IntroScreenProps {
  onComplete: () => void;
}

export function IntroScreen({ onComplete }: IntroScreenProps) {
  // Splash screen runs for exactly 0.75 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, 750);

    return () => clearTimeout(timer);
  }, [onComplete]);

  // Framer Motion Animation Variants
  const backLayerVariants: Variants = {
    initial: { y: '0%' },
    exit: {
      y: '-100%',
      transition: {
        duration: 0.8,
        ease: [0.85, 0, 0.15, 1] as const,
        delay: 0.1
      }
    }
  };

  const backdropVariants: Variants = {
    initial: { y: '0%' },
    exit: {
      y: '-100%',
      transition: { duration: 0.7, ease: [0.85, 0, 0.15, 1] as const }
    }
  };

  const containerVariants: Variants = {
    initial: { opacity: 0, scale: 0.95 },
    animate: {
      opacity: 1,
      scale: 1,
      transition: {
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1] as const,
        staggerChildren: 0.1
      }
    },
    exit: {
      opacity: 0,
      y: -60,
      transition: {
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1] as const
      }
    }
  };

  const logoRingVariants: Variants = {
    initial: { rotate: 0, scale: 0.8, opacity: 0 },
    animate: {
      rotate: 360,
      scale: 1,
      opacity: 1,
      transition: {
        rotate: { repeat: Infinity, duration: 16, ease: 'linear' as const },
        scale: { duration: 1.0, ease: [0.16, 1, 0.3, 1] as const },
        opacity: { duration: 0.8 }
      }
    }
  };

  const logoIrisVariants: Variants = {
    initial: { scale: 0.7, opacity: 0, y: 15 },
    animate: {
      scale: 1,
      opacity: 1,
      y: 0,
      transition: {
        delay: 0.1,
        duration: 0.9,
        ease: [0.16, 1, 0.3, 1] as const
      }
    }
  };

  const textVariants: Variants = {
    initial: { opacity: 0, y: 15 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] as const }
    }
  };

  return (
    <>
      {/* Secondary sliding backdrop layer (slides DOWN) */}
      <motion.div
        variants={backLayerVariants}
        initial="initial"
        exit="exit"
        className="fixed inset-0 z-99998 bg-[#121420] pointer-events-none"
      />

      {/* Main sliding backdrop layer (slides UP) */}
      <motion.div
        variants={backdropVariants}
        initial="initial"
        exit="exit"
        className="fixed inset-0 z-99999 flex flex-col items-center justify-center bg-[#0a0b10] select-none overflow-hidden"
      >
        {/* Decorative ambient glowing backdrops for high-end look */}
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none"
          style={{ animationDuration: '6s' }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-violet-600/5 blur-[150px] pointer-events-none"
          style={{ animationDuration: '8s' }}
        />

        <motion.div
          variants={containerVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex flex-col items-center text-center px-6 relative z-10"
        >
          {/* Animated Custom Tech-Shutter SVG Logo */}
          <div className="relative w-32 h-32 mb-8 flex items-center justify-center">
            <motion.svg
              variants={logoRingVariants}
              className="absolute w-full h-full text-primary/30"
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="8 8 20 6 12 12"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="4 6"
                className="opacity-50"
              />
            </motion.svg>

            {/* Pixora Logo Image */}
            <motion.img
              variants={logoIrisVariants}
              src="/pixora_logo.png"
              alt="Pixora Logo"
              className="w-20 h-20 object-contain relative z-10"
            />
          </div>

          {/* Brand Text */}
          <motion.div variants={textVariants} className="mb-2">
            <h1 className="text-4xl font-extrabold tracking-[0.25em] text-transparent bg-clip-text bg-linear-to-r from-white via-slate-200 to-primary drop-shadow-[0_2px_10px_rgba(100,116,255,0.15)] font-sans">
              PIXORA
            </h1>
            <p className="mt-2 text-xs font-medium tracking-[0.4em] text-muted-foreground uppercase opacity-85">
              High-Performance Image Gallery
            </p>
          </motion.div>
        </motion.div>
      </motion.div>
    </>
  );
}
