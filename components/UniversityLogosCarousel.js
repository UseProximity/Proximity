import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

const UNIVERSITIES = [
  {
    name: "University of California, Berkeley",
    logo: "/universities/berkeley.jpeg",
  },
  {
    name: "Columbia University",
    logo: "/universities/columbia.jpeg",
  },
  {
    name: "Washington University in St. Louis",
    logo: "/universities/gw.jpeg",
  },
  {
    name: "University of Alabama",
    logo: "/universities/ngu.jpeg",
  },
  {
    name: "Pennsylvania State University",
    logo: "/universities/pen.jpeg",
  },
  {
    name: "University of Southern California",
    logo: "/universities/sc.jpeg",
  },
  {
    name: "Southern Methodist University",
    logo: "/universities/smu.jpeg",
  },
  {
    name: "University of California, Los Angeles",
    logo: "/universities/ucla.jpeg",
  },
  {
    name: "Washington University in St. Louis",
    logo: "/universities/washu.jpeg",
  },
  { name: "Instituto Superior Técnico", logo: "/universities/ist.png" },
  { name: "Harvard University", logo: "/universities/harvard.png" },
  { name: "Stanford University", logo: "/universities/stanford.png" },
  {
    name: "Massachusetts Institute of Technology",
    logo: "/universities/mit.png",
  },
  { name: "Brown University", logo: "/universities/brown.png" },
];

export default function UniversityLogosCarousel() {
  const allLogos = [
    ...UNIVERSITIES,
    ...UNIVERSITIES,
    ...UNIVERSITIES,
    ...UNIVERSITIES,
    ...UNIVERSITIES,
    ...UNIVERSITIES,
  ];
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = "translateZ(0)";
      containerRef.current.style.backfaceVisibility = "hidden";
      containerRef.current.style.perspective = "1000px";
    }
  }, []);

  return (
    <section
      className="w-full py-12"
      style={{
        backgroundColor: "#ffffff",
        backgroundImage: "none",
        margin: 0,
        padding: 0,
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
      }}
    >
      <div
        className="w-full flex justify-center"
        style={{ padding: 0, margin: 0 }}
      >
        <div
          className="py-8 overflow-hidden w-full"
          style={{
            backgroundColor: "transparent",
            margin: "0 auto",
            padding: "2rem 0",
            transform: "translateZ(0)",
            backfaceVisibility: "hidden",
          }}
        >
          <div className="relative overflow-hidden w-full">
            <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-white via-white/95 to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-white via-white/95 to-transparent z-10 pointer-events-none" />

            <div className="w-full overflow-hidden flex justify-center">
              <motion.div
                ref={containerRef}
                className="flex items-center justify-center space-x-0 md:space-x-16"
                animate={{ x: [0, -(140 * UNIVERSITIES.length)] }}
                transition={{
                  x: {
                    repeat: Infinity,
                    repeatType: "loop",
                    duration: 60,
                    ease: "linear",
                    type: "tween",
                    times: [0, 1],
                  },
                }}
                style={{
                  width: `${allLogos.length * 140}px`,
                  willChange: "transform",
                  transform: "translateZ(0)",
                  backfaceVisibility: "hidden",
                  WebkitFontSmoothing: "antialiased",
                  MozOsxFontSmoothing: "grayscale",
                  WebkitTransform: "translateZ(0)",
                  WebkitBackfaceVisibility: "hidden",
                  WebkitPerspective: "1000px",
                }}
              >
                {allLogos.map((university, index) => (
                  <motion.div
                    key={`${university.name}-${index}`}
                    className="flex-shrink-0 flex items-center justify-center"
                    style={{
                      width: "120px",
                      height: "80px",
                      minWidth: "120px",
                      transform: "translateZ(0)",
                      backfaceVisibility: "hidden",
                    }}
                    whileHover={{
                      scale: 1.08,
                      transition: {
                        type: "spring",
                        stiffness: 800,
                        damping: 40,
                        duration: 0.01,
                        mass: 0.1,
                      },
                    }}
                    whileTap={{
                      scale: 0.98,
                      transition: {
                        duration: 0.01,
                        ease: "easeOut",
                      },
                    }}
                    exit={{
                      scale: 1,
                      transition: {
                        duration: 0.01,
                        ease: "easeOut",
                      },
                    }}
                  >
                    <img
                      src={university.logo || "/placeholder.svg"}
                      alt={`${university.name} logo`}
                      className="max-w-full max-h-full object-contain opacity-100 hover:opacity-100"
                      style={{
                        width: "100px",
                        height: "70px",
                        imageRendering: "crisp-edges",
                        WebkitImageRendering: "crisp-edges",
                        MozImageRendering: "crisp-edges",
                        transition: "all 0.01s cubic-bezier(0.4, 0, 0.2, 1)",
                        transform: "translateZ(0)",
                        backfaceVisibility: "hidden",
                      }}
                      loading="lazy"
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @media (prefers-reduced-motion: no-preference) {
          * {
            scroll-behavior: smooth;
          }
        }

        section * {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          -webkit-transform: translateZ(0);
          -moz-transform: translateZ(0);
          -ms-transform: translateZ(0);
          -o-transform: translateZ(0);
          transform: translateZ(0);
        }

        img {
          transition: all 0.01s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
      `}</style>
    </section>
  );
}
