/**
 * Explications du bouton ⓘ : ce que chaque réglage change sur la photo, en
 * langage de photographe, pas de documentation d'API.
 *
 * Toute clé utilisée par un `helpKey=` de l'écran doit exister ici, un test le
 * vérifie : un ⓘ qui n'affiche rien est un bug visible.
 */
export const HELP_TEXTS: Record<string, string> = {
  iso: "Sensibilité du capteur. En bas de la plage (25 à 100), l'image est propre mais sombre. Plus tu montes, plus elle s'éclaircit et plus le grain apparaît. Pour les étoiles, vise 1600 à 3200.",
  shutter:
    "Temps pendant lequel le capteur reçoit la lumière. Une vitesse rapide (1/500) fige le mouvement. Une vitesse lente capte plus de lumière, mais le moindre tremblement floute l'image. Pour les étoiles, 1 s sur trépied.",
  ev: "Correction d'exposition en mode auto. Vers + la photo s'éclaircit, vers − elle s'assombrit. Les autres réglages ne bougent pas.",
  focus:
    "Mise au point manuelle. 0 fait le net tout près, ∞ au loin. Pour un ciel étoilé ou un paysage, mets ∞.",
  wb: "Température de couleur en kelvins. 2500 K tire vers le bleu, 8000 K vers l'orangé. Sert à corriger la couleur de la lumière ambiante.",
  tint: "Complète la température sur l'axe vert-magenta. Utile sous les néons ou les LED qui verdissent l'image.",
  flash: "Éclair au déclenchement. En auto, il ne part que si la scène est sombre.",
  torch:
    "Lampe allumée en continu pendant la visée, avec intensité réglable. Pratique en vidéo ou pour faire le point la nuit.",
  resolution:
    "Le 12 MP fusionne les pixels : fichiers légers et meilleur rendu en basse lumière. Le 24 MP est le bon compromis au quotidien. Le 48 MP garde le maximum de détails et permet de recadrer large, avec des fichiers environ quatre fois plus lourds.",
  quality:
    "Niveau de traitement appliqué par l'iPhone. Max fusionne plusieurs images, c'est plus net mais un peu plus lent. Vitesse capture immédiatement avec un traitement minimal, au rendu plus brut.",
  bracket:
    "Trois photos d'affilée : une sombre, une normale, une claire. Tu choisis la bonne ensuite, ou tu les fusionnes en HDR.",
  livePhoto: "Enregistre environ 1,5 s de vidéo autour de la photo, sauvée dans un fichier séparé.",
  depth: "Enregistre la carte de profondeur avec la photo, pour les effets portrait en retouche.",
  codes:
    "Repère les codes QR et les codes-barres dans le viseur et affiche un bandeau. Touche-le pour ouvrir le lien. Sans effet sur tes photos, c'est juste une lecture de la préview.",
  timer: "Retarde le déclenchement. Le temps de caler le téléphone ou d'entrer dans le cadre.",
  grid: "Grille des tiers. Place ton sujet sur une ligne ou une intersection, la composition respire mieux.",
  nightVision:
    "Passe toute l'interface en rouge sombre. Tes yeux mettent 20 à 30 minutes à se réhabituer au noir après un écran lumineux, le rouge évite de perdre cette adaptation.",
  peaking:
    "Surligne en vert les zones nettes de l'image. C'est le plus simple pour réussir une mise au point manuelle, surtout la nuit.",
  zebras:
    "Marque en rouge les zones surexposées. Si une zone importante se raye, baisse l'ISO ou accélère la vitesse.",
  histogram:
    "Répartition des luminosités, ombres à gauche, hautes lumières à droite. Un paquet collé à droite signale une photo cramée, collé à gauche une photo bouchée.",
  level:
    "La ligne suit l'inclinaison du téléphone et devient verte quand l'horizon est droit.",
  align:
    "Recale chaque image sur la première pendant la pose. Permet de poser sans trépied si tu restes à peu près stable.",
  meteorFilter:
    "Ne garde pour la fusion max que les images où quelque chose est passé dans le ciel. Les traînées ressortent sur un fond plus propre.",
  videoRange:
    "Standard donne une vidéo lisible partout. HDR garde le détail dans les ciels et les néons, avec les couleurs de l'iPhone. Log aplatit l'image pour l'étalonner ensuite au montage : brut à l'œil, mais c'est le format qui garde le plus de matière.",
  videoCodec:
    "HEVC est le format normal, léger et lisible partout. ProRes garde bien plus de détails pour le montage, au prix d'environ six gigaoctets par minute en 4K. Réserve-le aux plans que tu vas vraiment retravailler.",
  stabilization:
    "Compense les tremblements en recadrant légèrement l'image. Auto laisse l'iPhone choisir. Max stabilise le plus fort et te fait perdre un peu de champ, pratique en marchant. Off garde tout le cadre, à réserver au trépied.",
  videoAudio:
    "Enregistre le son avec l'image. En muet, la vidéo est plus légère et tu évites les bruits de vent ou de manipulation quand tu comptes ajouter une musique ensuite.",
  autoNight:
    "Quand la scène est sombre et que tu es en photo simple, le déclencheur lance automatiquement une pose alignée de 10 s au lieu d'un cliché bruité. L'équivalent du mode Nuit d'Apple, en mieux réglable.",
};
