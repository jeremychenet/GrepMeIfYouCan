# GrepMeIfYouCan — Plan v2

Référence : [SPEC.md](./SPEC.md). La v1 (jalons J1 → J20) est livrée et en ligne depuis le 2026-10-29 ; son plan est archivé dans [docs/archive/PLAN-v1.md](./docs/archive/PLAN-v1.md).

**Conventions** (inchangées depuis la v1)
- Chaque jalon a un objectif, la liste des fichiers touchés et des critères de validation à cocher. Il est terminé quand **tous** ses critères sont cochés.
- Un jalon = une branche et une PR. Le mainteneur relit et fusionne ; le déploiement suit automatiquement.
- Tout s'exécute dans Docker (`make <cible>`), rien n'est installé sur le Mac.
- **Chaque jalon qui ajoute ou modifie du code livre ses tests dans la même PR** (SPEC §8.1), avec les seuils de couverture de la SPEC.

---

## Jalons v2

*À définir à partir de la liste du mainteneur.*

Déjà identifié :
- Action GitHub « issue labellisée `accepted` → PR avec le fichier YAML de la fiche » (SPEC §2.9 et §10). Aucune publication sans merge manuel.
