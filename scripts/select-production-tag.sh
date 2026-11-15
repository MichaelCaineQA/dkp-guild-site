#!/bin/sh
# Выполняется в checkout с полной историей до передачи кода и секретов серверу.
set -eu
tag=${RELEASE_TAG:-}
if [ -z "$tag" ]; then
  case "${GITHUB_REF:-}" in
    refs/tags/*) tag=${GITHUB_REF#refs/tags/} ;;
    *) echo 'Production требует тег: заполните release_tag или выберите ref тега.' >&2; exit 1 ;;
  esac
fi
git check-ref-format "refs/tags/$tag"
commit=$(git rev-parse --verify "refs/tags/$tag^{commit}")
# Не выпускаем экспериментальные коммиты из невлитых веток.
git merge-base --is-ancestor "$commit" refs/remotes/origin/main || {
  echo 'Тег production должен указывать на коммит из main.' >&2
  exit 1
}
git checkout --detach "$commit"
printf 'Production release: %s (%s)\n' "$tag" "$commit"
